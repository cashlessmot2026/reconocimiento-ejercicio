// Edge Function: envía los correos de AR-COMBAT por Gmail (SMTP con contraseña de aplicación).
//
// Secretos (Supabase → Edge Functions → Secrets). NUNCA van en el código ni en el repositorio:
//   GMAIL_USER          cuenta de Gmail que envía (ej. cashlesscolombia@gmail.com)
//   GMAIL_APP_PASSWORD  contraseña de aplicación de 16 caracteres (sin espacios)
//   MAILER_SECRET       texto largo y aleatorio; el mismo valor va en ej_mail_config.secret
//
// Despliegue (sin verificación JWT, porque la llama la base de datos con pg_net):
//   supabase functions deploy ar-mailer --no-verify-jwt
import nodemailer from "npm:nodemailer@6.9.14";

type Payload = {
  kind: "welcome_pending" | "approved" | "rejected" | "welcome_active" | "test";
  to: string;
  name?: string;
  code?: string;
  plan_name?: string;
  amount?: number;
  note?: string;
  app_url?: string;
};

const BRAND = "AR-COMBAT";
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cop = (n?: number) =>
  typeof n === "number" ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n) : "";

function layout(opts: { title: string; body: string; button?: { label: string; url: string } }) {
  const btn = opts.button?.url
    ? `<p style="text-align:center;margin:28px 0 8px"><a href="${esc(opts.button.url)}"
        style="background:linear-gradient(135deg,#22d3ee,#a78bfa);color:#041018;text-decoration:none;font-weight:700;
        padding:14px 28px;border-radius:12px;display:inline-block">${esc(opts.button.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#070a14;font-family:Segoe UI,Arial,sans-serif;color:#e8eefc">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <div style="text-align:center;margin-bottom:18px">
      <span style="display:inline-block;background:linear-gradient(135deg,#22d3ee,#a78bfa);color:#041018;font-weight:800;
        border-radius:12px;padding:10px 14px;letter-spacing:2px">AR</span>
      <div style="letter-spacing:6px;font-weight:700;margin-top:8px">${BRAND}</div>
    </div>
    <div style="background:#0f1528;border:1px solid #22d3ee55;border-radius:18px;padding:26px">
      <h1 style="margin:0 0 12px;font-size:22px">${opts.title}</h1>
      ${opts.body}
      ${btn}
    </div>
    <p style="text-align:center;color:#8b97b5;font-size:12px;margin-top:16px">${BRAND} · Gimnasio de boxeo</p>
  </div></body></html>`;
}

const codeBox = (code?: string) =>
  `<div style="text-align:center;margin:18px 0"><div style="color:#8b97b5;font-size:12px;letter-spacing:3px">TU CÓDIGO</div>
   <div style="font-family:Consolas,monospace;font-size:44px;font-weight:700;letter-spacing:8px;color:#22d3ee">${esc(code)}</div></div>`;

function build(p: Payload): { subject: string; html: string } {
  const name = esc(p.name || "campeón");
  const loginUrl = p.app_url ? `${p.app_url.replace(/\/$/, "")}/#ingresar` : "";
  switch (p.kind) {
    case "welcome_pending":
      return {
        subject: `Bienvenido a la familia ${BRAND}`,
        html: layout({
          title: `¡Bienvenido a la familia ${BRAND}, ${name}!`,
          body: `<p>Recibimos tu solicitud para el <b>${esc(p.plan_name)}</b>${p.amount ? ` (${cop(p.amount)})` : ""} y tu comprobante de pago.</p>
            ${codeBox(p.code)}
            <p>Guarda este código: es tu llave para entrar a la aplicación.
            <b>Tu acceso se activará cuando validemos tu pago</b>; te avisaremos por este mismo correo.</p>`,
        }),
      };
    case "approved":
      return {
        subject: `Pago aprobado · ya eres parte de ${BRAND}`,
        html: layout({
          title: `¡Pago aprobado, ${name}!`,
          body: `<p>Validamos tu pago del <b>${esc(p.plan_name)}</b>. Tu acceso ya está activo.</p>
            ${codeBox(p.code)}
            <p>Pulsa el botón, escribe tu código y entra a tu espacio de entrenamiento.</p>`,
          button: { label: "Ingresar a mi espacio", url: loginUrl },
        }),
      };
    case "rejected":
      return {
        subject: `Revisión de tu pago en ${BRAND}`,
        html: layout({
          title: `No pudimos validar tu pago`,
          body: `<p>Hola ${name}, revisamos tu comprobante del <b>${esc(p.plan_name)}</b> y no pudimos validarlo.</p>
            ${p.note ? `<p style="background:#ffffff0d;border-radius:10px;padding:10px 12px">${esc(p.note)}</p>` : ""}
            <p>Puedes volver a la página, elegir tu plan y adjuntar un comprobante nuevo.</p>`,
          button: p.app_url ? { label: "Volver a la página", url: p.app_url } : undefined,
        }),
      };
    case "welcome_active":
      return {
        subject: `Tu cuenta en ${BRAND} está lista`,
        html: layout({
          title: `¡Bienvenido a ${BRAND}, ${name}!`,
          body: `<p>Tu entrenador creó tu cuenta${p.plan_name ? ` con el <b>${esc(p.plan_name)}</b>` : ""}.</p>
            ${codeBox(p.code)}
            <p>Pulsa el botón y escribe tu código para empezar a entrenar.</p>`,
          button: { label: "Ingresar a mi espacio", url: loginUrl },
        }),
      };
    default:
      return { subject: `Prueba de correo · ${BRAND}`, html: layout({ title: "Correo de prueba", body: "<p>El envío de correos funciona.</p>" }) };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = Deno.env.get("MAILER_SECRET");
  if (!secret || req.headers.get("x-mailer-secret") !== secret) return new Response("forbidden", { status: 403 });

  let p: Payload;
  try { p = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (!p?.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.to)) return new Response("bad recipient", { status: 400 });

  const user = Deno.env.get("GMAIL_USER");
  const pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) return new Response("mail not configured", { status: 500 });

  const { subject, html } = build(p);
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass: pass.replace(/\s+/g, "") },
  });
  try {
    await transporter.sendMail({ from: `"${BRAND}" <${user}>`, to: p.to, subject, html });
    return new Response("ok");
  } catch (e) {
    console.error("mail error", e);
    return new Response("send failed", { status: 502 });
  }
});
