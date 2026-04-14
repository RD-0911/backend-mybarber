const transporter = require("../config/mailer");

const generarCodigo = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const enviarCorreoRecuperacion = async (correoDestino, codigo) => {
  const mailOptions = {
    from:    `"MyBarber 💈" <${process.env.EMAIL_USER}>`,
    to:      correoDestino,
    subject: "Código de recuperación - MyBarber",
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.10);">
        <div style="background: linear-gradient(135deg, #4a0080, #9b30d9); padding: 32px; text-align: center;">
          <h1 style="color: #fff; font-size: 28px; margin: 0; letter-spacing: 2px;">✂ MyBarber</h1>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">Recuperación de contraseña</p>
        </div>
        <div style="padding: 32px;">
          <p style="color: #333; font-size: 15px; margin: 0 0 16px;">Recibimos una solicitud para recuperar tu contraseña. Usa este código de verificación:</p>
          <div style="background: #f4f0ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; border: 2px dashed #c060ff;">
            <div style="font-size: 42px; font-weight: 900; letter-spacing: 12px; color: #4a0080; font-family: monospace;">${codigo}</div>
          </div>
          <p style="color: #888; font-size: 13px; margin: 0 0 8px;">⏱ Este código expira en <strong>10 minutos</strong>.</p>
          <p style="color: #888; font-size: 13px; margin: 0;">🔒 Si no solicitaste este cambio, puedes ignorar este correo.</p>
        </div>
        <div style="background: #faf7ff; padding: 16px 32px; border-top: 1px solid #ede0f7;">
          <p style="color: #bbb; font-size: 11px; margin: 0; text-align: center;">© 2025 MyBarber · Correo automático, no respondas este mensaje.</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = { generarCodigo, enviarCorreoRecuperacion };
