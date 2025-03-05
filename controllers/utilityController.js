// controllers/utilityController.js
const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const { getOrganizationId } = require('../utils/organizationContext');
const logger = require('../config/logger');

/**
 * Test database connection
 */
exports.testConnection = async (req, res) => {
	const client = await pool.connect();
	try {
		const result = await client.query("SELECT NOW()");
		return res.json({ success: true, time: result.rows[0] });
	} catch (error) {
		logger.error(`Database connection test failed: ${error.message}`);
		return res.status(500).json({ success: false, error: error.message });
	} finally {
		client.release();
	}
};

/**
 * Get initial data for application initialization
 */
exports.getInitialData = async (req, res) => {
	try {
		const isLoggedIn = req.session?.user_id !== undefined;
		const userRole = req.session?.user_role || null;
		const lang = req.session?.lang || "fr";

		const initialData = {
			isLoggedIn,
			userRole,
			lang,
		};

		return jsonResponse(res, true, initialData);
	} catch (error) {
		logger.error(`Error getting initial data: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	}
};

/**
 * Get available dates for filtering
 */
exports.getAvailableDates = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT DISTINCT date::date AS date 
			 FROM honors 
			 WHERE organization_id = $1 
			 ORDER BY date DESC`,
			[organizationId]
		);

		const dates = result.rows.map((row) => row.date);
		return jsonResponse(res, true, dates);
	} catch (error) {
		logger.error(`Error fetching available dates: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving dates");
	} finally {
		client.release();
	}
};

/**
 * Get available meeting/reunion dates
 */
exports.getReunionDates = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const datesResult = await client.query(
			`SELECT DISTINCT date 
			 FROM reunion_preparations 
			 WHERE organization_id = $1 
			 ORDER BY date DESC`,
			[organizationId]
		);

		const dates = datesResult.rows.map((row) => row.date);
		return jsonResponse(res, true, dates);
	} catch (error) {
		logger.error(`Error fetching reunion dates: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving reunion dates");
	} finally {
		client.release();
	}
};

/**
 * Get attendance dates
 */
exports.getAttendanceDates = async (req, res) => {
	const client = await pool.connect();
	try {
		const attendanceDatesResult = await client.query(
			`SELECT DISTINCT date 
			 FROM attendance 
			 WHERE date <= CURRENT_DATE 
			 ORDER BY date DESC`
		);

		const dates = attendanceDatesResult.rows.map((row) => row.date);
		return jsonResponse(res, true, dates);
	} catch (error) {
		logger.error(`Error fetching attendance dates: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving attendance dates");
	} finally {
		client.release();
	}
};

/**
 * Get subscribers
 */
exports.getSubscribers = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT s.id, s.user_id, u.email 
			 FROM subscribers s 
			 LEFT JOIN users u ON s.user_id = u.id
			 JOIN user_organizations uo ON u.id = uo.user_id
			 WHERE uo.organization_id = $1`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching subscribers: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving subscribers");
	} finally {
		client.release();
	}
};

/**
 * Get meeting activities
 */
exports.getActivitesRencontre = async (req, res) => {
	const client = await pool.connect();
	try {
		const result = await client.query(
			`SELECT * FROM activites_rencontre ORDER BY activity`
		);

		return jsonResponse(res, true, { activites: result.rows });
	} catch (error) {
		logger.error(`Error fetching activities: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving activities");
	} finally {
		client.release();
	}
};

/**
 * Get animators/facilitators
 */
exports.getAnimateurs = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT u.id, u.full_name 
			 FROM users u
			 JOIN user_organizations uo ON u.id = uo.user_id
			 WHERE uo.organization_id = $1 
			 AND uo.role IN ('animation')
			 ORDER BY u.full_name`,
			[organizationId]
		);

		return jsonResponse(res, true, { animateurs: result.rows });
	} catch (error) {
		logger.error(`Error fetching animators: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving animators");
	} finally {
		client.release();
	}
};

/**
 * Get guests by date
 */
exports.getGuestsByDate = async (req, res) => {
	const client = await pool.connect();
	try {
		const date = req.query.date || new Date().toISOString().split("T")[0];

		const guestsResult = await client.query(
			`SELECT * FROM guests WHERE attendance_date = $1`,
			[date]
		);

		return jsonResponse(res, true, guestsResult.rows);
	} catch (error) {
		logger.error(`Error fetching guests: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving guests");
	} finally {
		client.release();
	}
};

/**
 * Get attendance records by date
 */
exports.getAttendance = async (req, res) => {
	const client = await pool.connect();
	try {
		const date = req.query.date || new Date().toISOString().split("T")[0];
		const organizationId = getOrganizationId(req);

		const attendanceResult = await client.query(
			`SELECT a.participant_id, a.status
			 FROM attendance a
			 JOIN participants p ON a.participant_id = p.id
			 JOIN participant_organizations po ON po.participant_id = p.id
			 WHERE a.date = $1 AND po.organization_id = $2`,
			[date, organizationId]
		);

		return jsonResponse(res, true, attendanceResult.rows);
	} catch (error) {
		logger.error(`Error fetching attendance: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving attendance");
	} finally {
		client.release();
	}
};

/**
 * Get organization settings
 */
exports.getOrganizationSettings = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = req.user?.organizationId;

		if (!organizationId) {
			return jsonResponse(res, false, null, "Organization ID not found");
		}

		const settingsResult = await client.query(
			`SELECT setting_key, setting_value 
			 FROM organization_settings 
			 WHERE organization_id = $1`,
			[organizationId]
		);

		const settings = settingsResult.rows.reduce((acc, setting) => {
			try {
				const decodedValue = JSON.parse(setting.setting_value);
				acc[setting.setting_key] = decodedValue !== null ? decodedValue : setting.setting_value;
			} catch (e) {
				acc[setting.setting_key] = setting.setting_value;
			}
			return acc;
		}, {});

		return jsonResponse(res, true, settings);
	} catch (error) {
		logger.error(`Error fetching organization settings: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving organization settings");
	} finally {
		client.release();
	}
};

/**
 * Get organization ID from hostname
 */
exports.getOrganizationId = async (req, res) => {
	try {
		// Extract hostname from request
		const hostname = req.query.hostname || req.hostname;

		const client = await pool.connect();
		try {
			// Query the database for the organization ID based on hostname
			const result = await client.query(
				`SELECT organization_id FROM organization_domains 
				 WHERE domain = $1 OR $2 LIKE REPLACE(domain, '*', '%') 
				 LIMIT 1`,
				[hostname, hostname]
			);

			if (result.rows.length > 0) {
				const organizationId = result.rows[0].organization_id;
				return jsonResponse(res, true, { organizationId });
			} else {
				return jsonResponse(res, false, null, "No organization matches this domain");
			}
		} finally {
			client.release();
		}
	} catch (error) {
		logger.error(`Error fetching organization ID: ${error.message}`);
		return jsonResponse(res, false, null, "Error determining organization ID");
	}
};

/**
 * Get organization news
 */
exports.getNews = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = req.query.organization_id || req.user?.organizationId;

		if (!organizationId) {
			return jsonResponse(res, false, null, "Organization ID not found");
		}

		const result = await client.query(
			`SELECT n.*, u.full_name as author_name
			 FROM news n
			 LEFT JOIN users u ON n.author_id = u.id
			 WHERE n.organization_id = $1
			 ORDER BY n.created_at DESC`,
			[organizationId]
		);

		return jsonResponse(res, true, { news: result.rows });
	} catch (error) {
		logger.error(`Error fetching news: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving news");
	} finally {
		client.release();
	}
};

/**
 * Switch organization (for users with multiple organizations)
 */
exports.switchOrganization = async (req, res) => {
	const client = await pool.connect();
	try {
		const { organization_id: newOrgId } = req.body;
		const userId = req.user.id;

		await client.query("BEGIN");

		// Verify user has access to the organization
		const userOrgsResult = await client.query(
			`SELECT organization_id 
			 FROM user_organizations 
			 WHERE user_id = $1`,
			[userId]
		);

		const orgIds = userOrgsResult.rows.map(row => row.organization_id);

		if (!newOrgId || !orgIds.includes(newOrgId)) {
			throw new Error("Invalid organization ID");
		}

		// Update session with new organization if using session-based auth
		if (req.session) {
			req.session.current_organization_id = newOrgId;
		}

		// Update user's last accessed organization
		await client.query(
			`UPDATE user_organizations 
			 SET last_accessed = CURRENT_TIMESTAMP 
			 WHERE user_id = $1 AND organization_id = $2`,
			[userId, newOrgId]
		);

		await client.query("COMMIT");
		return jsonResponse(res, true, null, "Organization switched successfully");
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Error switching organization: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

module.exports = exports;