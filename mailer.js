const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const sanitize = (val) => val ? val.trim().replace(/[`'"]+/g, '') : '';

const MAIL_HOST = sanitize(process.env.MAIL_HOST);
const MAIL_PORT = process.env.MAIL_PORT;
const MAIL_USER = sanitize(process.env.MAIL_USER);
const MAIL_PASS = sanitize(process.env.MAIL_PASS);
const MAIL_FROM = process.env.MAIL_FROM; // Keep from as is, might have quotes in display name
const MAIL_TO = sanitize(process.env.MAIL_TO);

// Check if mailer is configured
const isConfigured = MAIL_HOST && MAIL_USER && MAIL_PASS && MAIL_TO;

let transporter = null;

if (isConfigured) {
    transporter = nodemailer.createTransport({
        host: MAIL_HOST,
        port: parseInt(MAIL_PORT || '587'),
        secure: MAIL_PORT === '465', // true for 465, false for other ports
        auth: {
            user: MAIL_USER,
            pass: MAIL_PASS
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000
    });
} else {
    console.warn('[MAILER] SMTP credentials not fully configured. Mail sending will be disabled.');
}

/**
 * Send contact form email
 * @param {Object} data - { company, name, position, email, phone, scale, subject, message }
 */
async function sendContactEmail(data) {
    if (!transporter) {
        console.warn('[MAILER] Cannot send email: transporter not configured.');
        return { success: false, error: 'Mailer not configured' };
    }

    const { company, name, position, email, phone, scale, subject, message } = data;

    const scaleLabel = scale ? {
        '50': 'Dưới 50 điểm',
        '200': '50 - 200 điểm',
        '500': '200 - 500 điểm',
        '1000': 'Trên 1.000 điểm'
    }[scale] || scale : 'N/A';

    const mailOptions = {
        from: MAIL_FROM || MAIL_USER,
        to: MAIL_TO,
        subject: `[Contact Form] ${subject || 'New Inquiry'}`,
        text: `
Tên doanh nghiệp: ${company || 'N/A'}
Họ và tên: ${name}
Chức vụ: ${position || 'N/A'}
Email: ${email}
Số điện thoại: ${phone || 'N/A'}
Quy mô: ${scaleLabel}

Yêu cầu cụ thể:
${message || 'N/A'}
        `,
        html: `
            <h3>New Contact Form Submission</h3>
            <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
                <tr><td style="padding: 8px 12px; font-weight: bold; width: 140px;">Tên doanh nghiệp</td><td style="padding: 8px 12px;">${company || 'N/A'}</td></tr>
                <tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: bold;">Họ và tên</td><td style="padding: 8px 12px;">${name}</td></tr>
                <tr><td style="padding: 8px 12px; font-weight: bold;">Chức vụ</td><td style="padding: 8px 12px;">${position || 'N/A'}</td></tr>
                <tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: bold;">Email</td><td style="padding: 8px 12px;">${email}</td></tr>
                <tr><td style="padding: 8px 12px; font-weight: bold;">Số điện thoại</td><td style="padding: 8px 12px;">${phone || 'N/A'}</td></tr>
                <tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: bold;">Quy mô dự kiến</td><td style="padding: 8px 12px;">${scaleLabel}</td></tr>
            </table>
            <br>
            <p><strong>Yêu cầu cụ thể:</strong></p>
            <p style="white-space: pre-wrap; padding: 12px; background: #f9f9f9; border-left: 4px solid #007bff;">${message || 'N/A'}</p>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('[MAILER] Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('[MAILER] Send error:', error.message);
        const backupDir = path.join(__dirname, 'backup_contacts');
        fs.mkdirSync(backupDir, { recursive: true });
        const filename = `contact_${Date.now()}.json`;
        fs.writeFileSync(path.join(backupDir, filename), JSON.stringify(data, null, 2));
        console.log('[MAILER] Contact saved to', filename);
        return { success: false, error: 'Email service temporarily unavailable' };
    }
}

module.exports = {
    sendContactEmail,
    isConfigured: () => !!transporter
};
