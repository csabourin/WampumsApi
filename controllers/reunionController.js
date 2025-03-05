// controllers/reunionController.js
const { pool } = require('../config/database');
const { getOrganizationId } = require('../utils/organizationContext');
const logger = require('../config/logger');

/**
 * Get reunion preparation data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getReunionPreparation = async (req, res) => {
	const date = req.query.date || new Date().toISOString().split('T')[0];
	const organizationId = getOrganizationId(req);

	const client = await pool.connect();
	try {
		const result = await client.query(
			`SELECT * FROM reunion_preparations
			 WHERE organization_id = $1 AND date = $2`,
			[organizationId, date]
		);

		if (result.rows.length > 0) {
			const preparation = result.rows[0];
			// Parse JSON fields
			preparation.louveteau_dhonneur = JSON.parse(preparation.louveteau_dhonneur || '[]');
			preparation.activities = JSON.parse(preparation.activities || '[]');
			res.json({ success: true, data: preparation });
		} else {
			res.json({
				success: false,
				message: "No reunion preparation found for this date"
			});
		}
	} catch (error) {
		logger.error(`Error fetching reunion preparation: ${error.message}`);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Save reunion preparation data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.saveReunionPreparation = async (req, res) => {
	const {
		date,
		animateur_responsable,
		louveteau_dhonneur,
		endroit,
		activities,
		notes
	} = req.body;

	const organizationId = getOrganizationId(req);
	const client = await pool.connect();

	try {
		await client.query(
			`INSERT INTO reunion_preparations (organization_id, date, animateur_responsable, louveteau_dhonneur, endroit, activities, notes)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (organization_id, date) DO UPDATE SET
			 animateur_responsable = EXCLUDED.animateur_responsable,
			 louveteau_dhonneur = EXCLUDED.louveteau_dhonneur,
			 endroit = EXCLUDED.endroit,
			 activities = EXCLUDED.activities,
			 notes = EXCLUDED.notes,
			 updated_at = CURRENT_TIMESTAMP`,
			[
				organizationId,
				date,
				animateur_responsable,
				JSON.stringify(louveteau_dhonneur),
				endroit,
				JSON.stringify(activities),
				notes
			]
		);

		res.json({ success: true, message: "Reunion preparation saved successfully" });
	} catch (error) {
		logger.error(`Error saving reunion preparation: ${error.message}`);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Get all reunion dates
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getReunionDates = async (req, res) => {
	const organizationId = getOrganizationId(req);
	const client = await pool.connect();

	try {
		const datesResult = await client.query(
			`SELECT DISTINCT date 
			 FROM reunion_preparations 
			 WHERE organization_id = $1 
			 ORDER BY date DESC`,
			[organizationId]
		);

		res.json({
			success: true,
			data: datesResult.rows.map(row => row.date)
		});
	} catch (error) {
		logger.error(`Error fetching reunion dates: ${error.message}`);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Save reminder for reunion
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.saveReminder = async (req, res) => {
	const { reminder_date, is_recurring, reminder_text } = req.body;
	const organizationId = getOrganizationId(req);
	const client = await pool.connect();

	try {
		await client.query(
			`INSERT INTO rappel_reunion (organization_id, reminder_date, is_recurring, reminder_text)
			 VALUES ($1, $2, $3, $4)`,
			[organizationId, reminder_date, is_recurring, reminder_text]
		);

		res.json({ success: true, message: "Reminder saved successfully" });
	} catch (error) {
		logger.error(`Error saving reminder: ${error.message}`);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Get reminder for reunion
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getReminder = async (req, res) => {
	const organizationId = getOrganizationId(req);
	const client = await pool.connect();

	try {
		const reminderResult = await client.query(
			`SELECT * FROM rappel_reunion 
			 WHERE organization_id = $1 
			 ORDER BY creation_time DESC 
			 LIMIT 1`,
			[organizationId]
		);

		if (reminderResult.rows.length > 0) {
			res.json({ success: true, data: reminderResult.rows[0] });
		} else {
			res.json({ success: false, message: "No reminder found" });
		}
	} catch (error) {
		logger.error(`Error fetching reminder: ${error.message}`);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Get next meeting information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getNextMeetingInfo = async (req, res) => {
	const organizationId = getOrganizationId(req);
	const client = await pool.connect();

	try {
		const nextMeetingResult = await client.query(
			`SELECT date, endroit, animateur_responsable, activities 
			 FROM reunion_preparations 
			 WHERE organization_id = $1 AND date >= CURRENT_DATE 
			 ORDER BY date ASC LIMIT 1`,
			[organizationId]
		);

		if (nextMeetingResult.rows.length > 0) {
			const meetingInfo = nextMeetingResult.rows[0];
			meetingInfo.activities = JSON.parse(meetingInfo.activities || '[]');
			res.json({ success: true, data: meetingInfo });
		} else {
			res.json({ success: false, message: "No upcoming meetings found" });
		}
	} catch (error) {
		logger.error(`Error fetching next meeting info: ${error.message}`);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Get meeting activities
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getActivitesRencontre = async (req, res) => {
	const client = await pool.connect();

	try {
		const result = await client.query(
			`SELECT * FROM activites_rencontre ORDER BY activity`
		);

		res.json({ success: true, data: { activites: result.rows } });
	} catch (error) {
		logger.error(`Error fetching meeting activities: ${error.message}`);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};

/**
 * Get animators/facilitators for meetings
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAnimateurs = async (req, res) => {
	const organizationId = getOrganizationId(req);
	const client = await pool.connect();

	try {
		const result = await client.query(
			`SELECT u.id, u.full_name 
			 FROM users u
			 JOIN user_organizations uo ON u.id = uo.user_id
			 WHERE uo.organization_id = $1 
			 AND uo.role IN ('animation')
			 ORDER BY u.full_name`,
			[organizationId]
		);

		res.json({ success: true, data: { animateurs: result.rows } });
	} catch (error) {
		logger.error(`Error fetching animateurs: ${error.message}`);
		res.json({ success: false, message: `Error: ${error.message}` });
	} finally {
		client.release();
	}
};