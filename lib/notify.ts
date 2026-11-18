import { contact } from "@/lib/contact";

/**
 * Tells OHI by email that the homeowner posted something. Delivery only: the
 * email says what kind of update it is and links straight to it, and replies
 * go nowhere. Sent through Resend; without RESEND_API_KEY nothing is sent.
 * Resend's shared sender delivers only to the address the Resend account was
 * opened with, which is the notification address.
 */
export async function notifyOhi({ project, what, link }: { project: string; what: string; link: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const subject = `New update in the Huddle: ${project}`;
  const html = `<!doctype html><html><body style="margin:0;padding:32px 20px;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;color:#1c1c1e">
<div style="max-width:440px;margin:0 auto;padding:24px;border-radius:18px;background:#ffffff">
<p style="margin:0 0 4px;color:#6e6e73;font-size:13px">${escape(project)}</p>
<p style="margin:0 0 20px;font-size:17px;line-height:22px">${escape(what)}</p>
<a href="${escape(link)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1c1c1e;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">Open in the Huddle</a>
</div></body></html>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Project Huddle <onboarding@resend.dev>",
      to: [contact.notifyEmail],
      subject,
      text: `${project}\n\n${what}\n\nOpen in the Huddle: ${link}`,
      html,
    }),
  });
  if (!res.ok) console.error("Huddle notification email failed", res.status, await res.text().catch(() => ""));
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
