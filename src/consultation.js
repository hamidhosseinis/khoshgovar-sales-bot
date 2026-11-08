// Customer-facing, public Telegram contact link. This is not an admin identity.
export const CONSULTATION_BUTTON_TEXT = '💬 مشاوره';
export const CONSULTATION_CHAT_URL = 'https://t.me/Hamidhosseinis';

export function isConsultationRequest(content) {
  return content === CONSULTATION_BUTTON_TEXT ||
    content === '/consult' || content === '/contact';
}

export function consultationReply() {
  return {
    text: '💬 برای مشاوره درباره محصولات و طرح‌های فروش، دکمه زیر را بزنید تا گفت‌وگوی خصوصی تلگرام با مشاور باز شود.',
    reply_markup: {
      inline_keyboard: [[{ text: '💬 گفت‌وگوی مستقیم با مشاور', url: CONSULTATION_CHAT_URL }]],
    },
  };
}
