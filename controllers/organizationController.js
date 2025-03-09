// controllers/organizationController.js
const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const { getOrganizationId } = require('../utils/organizationContext');
const { determineOrganizationId } = require('../utils');
const logger = require('../config/logger');

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
				logger.info(`Resolved organization ID ${organizationId} for hostname ${hostname}`);
				return jsonResponse(res, true, { organizationId });
			} else {
				logger.warn(`No organization found for hostname ${hostname}`);
				return jsonResponse(res, false, null, "No organization matches this domain");
			}
		} finally {
			client.release();
		}
	} catch (error) {
		logger.error(`Error determining organization ID: ${error.message}`);
		return jsonResponse(res, false, null, "Error determining organization ID");
	}
};

/**
 * Create a new organization
 */
exports.createOrganization = async (req, res) => {
	const client = await pool.connect();
	try {
		const { name } = req.body;
		const userId = req.user.id;

		await client.query("BEGIN");

		// Create the organization
		const newOrgResult = await client.query(
			`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
			[name]
		);

		const newOrganizationId = newOrgResult.rows[0].id;

		// Copy default form formats from template (organization_id 0)
		await client.query(
			`INSERT INTO organization_form_formats (organization_id, form_type, form_structure, display_type)
			 SELECT $1, form_type, form_structure, 'public'
			 FROM organization_form_formats
			 WHERE organization_id = 0`,
			[newOrganizationId]
		);

		// Store organization settings
		await client.query(
			`INSERT INTO organization_settings (organization_id, setting_key, setting_value)
			 VALUES ($1, 'organization_info', $2)`,
			[newOrganizationId, JSON.stringify(req.body)]
		);

		// Associate creating user as admin
		await client.query(
			`INSERT INTO user_organizations (user_id, organization_id, role)
			 VALUES ($1, $2, 'admin')`,
			[userId, newOrganizationId]
		);

		await client.query("COMMIT");

		logger.info(`Organization created: ${name} (ID: ${newOrganizationId}) by user ${userId}`);
		return jsonResponse(res, true, { organizationId: newOrganizationId }, "Organization created successfully");
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Error creating organization: ${error.message}`);
		return jsonResponse(res, false, null, `Error creating organization: ${error.message}`);
	} finally {
		client.release();
	}
};

/**
 * Update organization settings
 */
exports.updateOrganizationSettings = async (req, res) => {
	const client = await pool.connect();
	try {
		const { setting_key, setting_value } = req.body;
		const organizationId = getOrganizationId(req);

		if (!setting_key || setting_value === undefined) {
			return jsonResponse(res, false, null, "Missing required fields");
		}

		// Check if setting exists
		const existingResult = await client.query(
			`SELECT id FROM organization_settings 
			 WHERE organization_id = $1 AND setting_key = $2`,
			[organizationId, setting_key]
		);

		const valueToStore = typeof setting_value === 'object' 
			? JSON.stringify(setting_value) 
			: setting_value;

		if (existingResult.rows.length > 0) {
			// Update existing setting
			await client.query(
				`UPDATE organization_settings 
				 SET setting_value = $1, updated_at = CURRENT_TIMESTAMP 
				 WHERE organization_id = $2 AND setting_key = $3`,
				[valueToStore, organizationId, setting_key]
			);
		} else {
			// Insert new setting
			await client.query(
				`INSERT INTO organization_settings (organization_id, setting_key, setting_value)
				 VALUES ($1, $2, $3)`,
				[organizationId, setting_key, valueToStore]
			);
		}

		logger.info(`Organization settings updated: ${setting_key} for org ${organizationId}`);
		return jsonResponse(res, true, null, "Organization settings updated successfully");
	} catch (error) {
		logger.error(`Error updating organization settings: ${error.message}`);
		return jsonResponse(res, false, null, `Error updating organization settings: ${error.message}`);
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
		const organizationId = req.query.organization_id || req.user?.organizationId;

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
 * Register user for organization
 */
exports.registerForOrganization = async (req, res) => {
	const client = await pool.connect();
	try {
		const { registration_password, role, link_children } = req.body;
		const userId = req.user.id;
		const organizationId = getOrganizationId(req);

		// Verify registration password
		const correctPasswordResult = await client.query(
			`SELECT setting_value 
			 FROM organization_settings 
			 WHERE setting_key = 'registration_password' 
			 AND organization_id = $1`,
			[organizationId]
		);

		const correctPassword = correctPasswordResult.rows[0]?.setting_value;

		if (!correctPassword || registration_password !== correctPassword) {
			return jsonResponse(res, false, null, "Invalid registration password");
		}

		await client.query("BEGIN");

		// Add user to organization with specified role
		await client.query(
			`INSERT INTO user_organizations (user_id, organization_id, role) 
			 VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, organization_id) DO UPDATE SET
			 role = EXCLUDED.role`,
			[userId, organizationId, role]
		);

		// Link children if provided
		if (link_children && link_children.length > 0) {
			for (const childId of link_children) {
				await client.query(
					`INSERT INTO participant_organizations (participant_id, organization_id)
					 VALUES ($1, $2)
					 ON CONFLICT (participant_id, organization_id) DO NOTHING`,
					[childId, organizationId]
				);
			}
		}

		await client.query("COMMIT");

		logger.info(`User ${userId} registered for organization ${organizationId} with role ${role}`);
		return jsonResponse(res, true, null, "Successfully registered for organization");
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Error registering for organization: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Switch active organization (for users with multiple organizations)
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

		logger.info(`User ${userId} switched to organization ${newOrgId}`);
		return jsonResponse(res, true, { organizationId: newOrgId }, "Organization switched successfully");
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Error switching organization: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get available organizations for a user
 */
exports.getUserOrganizations = async (req, res) => {
	const client = await pool.connect();
	try {
		const userId = req.user.id;

		const result = await client.query(
			`SELECT o.id, o.name, uo.role, uo.last_accessed
			 FROM organizations o
			 JOIN user_organizations uo ON o.id = uo.organization_id
			 WHERE uo.user_id = $1
			 ORDER BY uo.last_accessed DESC NULLS LAST`,
			[userId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error fetching user organizations: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Create news item for organization
 */
exports.createNews = async (req, res) => {
	const client = await pool.connect();
	try {
		const { title, content, is_pinned, is_published } = req.body;
		const organizationId = getOrganizationId(req);
		const userId = req.user.id;

		if (!title || !content) {
			return jsonResponse(res, false, null, "Title and content are required");
		}

		const result = await client.query(
			`INSERT INTO news (organization_id, title, content, is_pinned, is_published, author_id)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING id`,
			[
				organizationId,
				title,
				content,
				is_pinned || false,
				is_published !== undefined ? is_published : true,
				userId
			]
		);

		const newsId = result.rows[0].id;
		logger.info(`News item created: ${title} (ID: ${newsId}) for org ${organizationId}`);
		return jsonResponse(res, true, { newsId }, "News item created successfully");
	} catch (error) {
		logger.error(`Error creating news item: ${error.message}`);
		return jsonResponse(res, false, null, `Error creating news item: ${error.message}`);
	} finally {
		client.release();
	}
};

/**
 * Get news for organization
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
			 ORDER BY n.is_pinned DESC, n.created_at DESC`,
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

module.exports = exports;