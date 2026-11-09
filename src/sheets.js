import { publicData } from './engine.js';

// Google Cloud service-account must be shared on the spreadsheet as a reader.
// The JSON credential is a Cloudflare secret, never a source file or customer value.
// The canonical workbook now embeds variants_json in Products and no longer
// contains a Product_Variants tab. Referencing a deleted tab makes the entire
// Sheets values:batchGet request fail, including the published product list.
const TABS = {
  Products:'A1:U1000', Discount_Plans:'A1:M201', Product_Plans:'A1:E1001',
  Plan_Requirements:'A1:I501', Plan_Discount_Targets:'A1:E501',
};
let tokenCache = null;
let dataCache = null;
const encoder = new TextEncoder();
function b64url(bytes) {
  let str=''; for(const b of bytes) str+=String.fromCharCode(b);
  return btoa(str).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function json64(value) { return b64url(encoder.encode(JSON.stringify(value))); }
async function accessToken(json, requestFetch) {
  if(tokenCache && tokenCache.email===json.client_email && tokenCache.exp>Date.now()+120000)
    return tokenCache.token;
  if(!json.private_key || !json.client_email || !json.token_uri) throw Error('google_credentials_missing');
  const data=json.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const raw=Uint8Array.from(atob(data), c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',raw.buffer,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const now=Math.floor(Date.now()/1000);
  const assertion=json64({alg:'RS256',typ:'JWT'})+'.'+json64({
    iss:json.client_email, scope:'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,
  });
  const signature=b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(assertion))));
  const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:assertion+'.'+signature});
  const res=await requestFetch('https://oauth2.googleapis.com/token',{method:'POST',body});
  if(!res.ok) throw Error('google_auth_failed');
  const result=await res.json();
  if(!result.access_token) throw Error('google_auth_failed');
  tokenCache={email:json.client_email,token:result.access_token,exp:Date.now()+Number(result.expires_in||3600)*1000};
  return tokenCache.token;
}
function rowsFromTable(table) {
  const [headers,...rows]=table || [];
  if(!headers) return [];
  return rows.filter(r=>r.some(v=>String(v ?? '').trim())).map(r=>{
    const obj={};
    headers.forEach((h,i)=>{if(h)obj[String(h).trim()]=String(r[i] ?? '').trim();});
    return obj;
  });
}
export async function sheetCatalog(env, requestFetch=fetch, now=Date.now()) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      !env.SALES_SPREADSHEET_ID) throw Error('sheet_not_configured');
  if (dataCache && dataCache.id === env.SALES_SPREADSHEET_ID && dataCache.exp>now) return dataCache.data;
  let credentials;
  try { credentials=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); }
  catch { throw Error('google_credentials_invalid'); }
  const token=await accessToken(credentials, requestFetch);
  const ranges=Object.entries(TABS).map(([name,range])=>name+'!'+range);
  const params=new URLSearchParams();
  for(const range of ranges)params.append('ranges',range);
  params.set('valueRenderOption','UNFORMATTED_VALUE');
  const endpoint='https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(env.SALES_SPREADSHEET_ID)+'/values:batchGet?'+params.toString();
  const res=await requestFetch(endpoint,{headers:{authorization:'Bearer '+token}});
  if(!res.ok)throw Error('sheet_unavailable');
  const payload=await res.json();
  if(!Array.isArray(payload.valueRanges) || payload.valueRanges.length!==ranges.length)
    throw Error('sheet_invalid');
  const rows={};
  Object.keys(TABS).forEach((name,index)=>{rows[name]=rowsFromTable(payload.valueRanges[index]?.values);});
  const data=publicData(rows,new Date(now).toISOString().slice(0,10));
  // A failed remote refresh must fail closed; a prior snapshot is NOT served after expiry.
  dataCache={id:env.SALES_SPREADSHEET_ID,data,exp:now+60000};
  return data;
}
