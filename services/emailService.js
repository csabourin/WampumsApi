// services/emailService.js
const sendgrid = require('@sendgrid/mail');
const { pool } = require('../config/database');
const logger = require('../config/logger');

// Set SendGrid API key from environment variables
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
if (SENDGRID_API_KEY) {
		sendgrid.setApiKey(SENDGRID_API_KEY);
}

/**
 * Send verification email to admin(s) when a new animator registers
 * @param {number} organizationId - The organization ID
 * @param {string} animatorName - The animator's name
 * @param {string} animatorEmail - The animator's email
 * @returns {Promise<void>}
 */
exports.sendAdminVerificationEmail = async (organizationId, animatorName, animatorEmail) => {
		const client = await pool.connect();
		try {
				// Fetch admin emails
				const result = await client.query(
						`SELECT u.email FROM users u
						 JOIN user_organizations uo ON u.id = uo.user_id
						 WHERE uo.organization_id = $1 AND uo.role = 'admin'`,
						[organizationId]
				);
				const adminEmails = result.rows.map(row => row.email);

				if (adminEmails.length === 0) {
						logger.warn(`No admin emails found for organization ID: ${organizationId}`);
						return;
				}

				// Fetch organization name
				const orgResult = await client.query(
						`SELECT setting_value->>'name' AS org_name
						 FROM organization_settings
						 WHERE organization_id = $1 AND setting_key = 'organization_info'`,
						[organizationId]
				);
				const orgName = orgResult.rows[0]?.org_name || 'Wampums.app';

				const subject = `New animator registration for ${orgName}`;
				const message = `A new animator has registered for ${orgName}.\n\nName: ${animatorName}\nEmail: ${animatorEmail}\n\nPlease log in to approve or reject this registration.`;

				// Send email to all admins
				if (SENDGRID_API_KEY) {
						for (const adminEmail of adminEmails) {
								try {
										await sendgrid.send({
												to: adminEmail,
												from: 'noreply@wampums.app',
												subject,
												text: message
										});
										logger.info(`Admin verification email sent to ${adminEmail}`);
								} catch (error) {
										logger.error(`Failed to send email to ${adminEmail}: ${error.message}`);
								}
						}
				} else {
						logger.warn('SendGrid API key not set, skipping email sending');
				}
		} catch (error) {
				logger.error(`Error sending admin verification email: ${error.message}`);
		} finally {
				client.release();
		}
};