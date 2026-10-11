export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}

function emailHtml(content: string): string {
  return `<!doctype html><html lang="ru"><body style="margin:0;background:#f6f7fb;color:#18212f;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:14px"><div style="font-size:24px;font-weight:700;margin-bottom:24px">Shards</div>${content}<p style="margin-top:28px">С уважением,<br><strong>Команда Shards</strong></p></main></body></html>`;
}

export function renderEmailVerificationEmail(input: { code: string; expireMinutes: number }): RenderedEmail {
  const code = escapeHtml(input.code);
  const expireMinutes = Math.max(1, Math.floor(input.expireMinutes));
  return {
    subject: "Подтверждение адреса электронной почты — Shards",
    text: `Здравствуйте!\n\nБлагодарим за регистрацию.\n\nДля подтверждения адреса электронной почты введите код ниже:\n\nКод подтверждения: ${input.code}\n\nКод действителен в течение ${expireMinutes} минут.\n\nЕсли вы не запрашивали подтверждение электронной почты, просто проигнорируйте это письмо. Никому не сообщайте код подтверждения.\n\nС уважением,\nКоманда Shards`,
    html: emailHtml(`<p>Здравствуйте!</p><p>Благодарим за регистрацию.</p><p>Для подтверждения адреса электронной почты введите код ниже:</p><p style="font-size:24px;font-weight:700;letter-spacing:3px;padding:16px;background:#f0f3ff;border-radius:8px">${code}</p><p>Код действителен в течение ${expireMinutes} минут.</p><p>Если вы не запрашивали подтверждение электронной почты, просто проигнорируйте это письмо. Никому не сообщайте код подтверждения.</p>`),
  };
}
