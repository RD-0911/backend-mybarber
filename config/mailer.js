const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: "a8264a001@smtp-brevo.com",
    pass: process.env.BREVO_SMTP_PASS,
  },
});

module.exports = transporter;