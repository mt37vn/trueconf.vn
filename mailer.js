const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM;
const MAIL_TO = process.env.MAIL_TO;

const isConfigured = !!(RESEND_API_KEY && MAIL_TO);

let resend = null;

if (isConfigured) {
    resend = new Resend(RESEND_API_KEY);
} else {
    console.warn('[MAILER] Resend API key not configured. Mail sending will be disabled.');
}

async function sendContactEmail(data) {
    if (!resend) {
        console.warn('[MAILER] Cannot send email: Resend not configured.');
        return { success: false, error: 'Mailer not configured' };
    }

    const { company, name, position, email, phone, scale, subject, message } = data;

    const scaleLabel = scale ? {
        '50': 'Dưới 50 điểm',
        '200': '50 - 200 điểm',
        '500': '200 - 500 điểm',
        '1000': 'Trên 1.000 điểm'
    }[scale] || scale : 'N/A';

    const text = `
Tên doanh nghiệp: ${company || 'N/A'}
Họ và tên: ${name}
Chức vụ: ${position || 'N/A'}
Email: ${email}
Số điện thoại: ${phone || 'N/A'}
Quy mô: ${scaleLabel}

Yêu cầu cụ thể:
${message || 'N/A'}
    `;

    const html = `
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
    `;

    try {
        const { data: result, error } = await resend.emails.send({
            from: MAIL_FROM || 'trueconf@haproinfo.vn',
            to: [MAIL_TO],
            subject: `[Contact Form] ${subject || 'New Inquiry'}`,
            text,
            html,
        });

        if (error) throw error;

        console.log('[MAILER] Email sent:', result.id);
        return { success: true, messageId: result.id };
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
    isConfigured: () => !!resend
};
