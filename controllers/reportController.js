// controllers/reportController.js
const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const { getOrganizationId } = require('../utils/organizationContext');
const logger = require('../config/logger');

/**
 * Get health contact report - comprehensive health and contact info for all participants
 */
exports.getHealthContactReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT p.id AS participant_id, p.first_name, p.last_name, p.date_naissance, 
				g.name AS group_name, COALESCE(fs.submission_data->>'epipen', 'false')::boolean AS epipen,
				fs.submission_data->>'allergie' AS allergies, 
				fs.submission_data->>'probleme_sante' AS health_issues,
				fs.submission_data->>'niveau_natation' AS swimming_level,
				fs.submission_data->>'blessures_operations' AS injuries,
				fs2.submission_data->>'peut_partir_seul' AS leave_alone,
				fs2.submission_data->>'consentement_photos_videos' AS media_consent
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			LEFT JOIN groups g ON pg.group_id = g.id
			LEFT JOIN form_submissions fs ON p.id = fs.participant_id 
					AND fs.form_type = 'fiche_sante' AND fs.organization_id = $1
			LEFT JOIN form_submissions fs2 ON p.id = fs2.participant_id 
					AND fs2.form_type = 'participant_registration' AND fs2.organization_id = $1
			WHERE EXISTS (
				SELECT 1 FROM participant_organizations po 
				WHERE po.organization_id = $1 AND po.participant_id = p.id
			)
			ORDER BY g.name, p.last_name, p.first_name`,
			[organizationId]
		);

		return jsonResponse(res, true, { health_report: result.rows });
	} catch (error) {
		logger.error(`Error generating health contact report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get health report - health information for all participants
 */
exports.getHealthReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT p.id as participant_id, p.first_name, p.last_name,
				fs.submission_data->>'epipen' AS epipen,
				fs.submission_data->>'allergie' AS allergies,
				fs.submission_data->>'probleme_sante' AS health_issues,
				fs.submission_data->>'niveau_natation' AS swimming_level,
				fs.submission_data->>'blessures_operations' AS injuries,
				fs2.submission_data->>'peut_partir_seul' AS leave_alone,
				fs2.submission_data->>'consentement_photos_videos' AS media_consent
			FROM participants p
			JOIN form_submissions fs ON fs.participant_id = p.id AND fs.form_type = 'fiche_sante'
			JOIN form_submissions fs2 ON fs2.participant_id = p.id AND fs2.form_type = 'participant_registration'
			JOIN participant_organizations po ON po.participant_id = p.id
			WHERE po.organization_id = $1`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error generating health report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get allergies report - allergy information for participants with allergies
 */
exports.getAllergiesReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				p.first_name || ' ' || p.last_name AS name,
				g.name AS group_name,
				fs.submission_data->>'allergie' AS allergies,
				(fs.submission_data->>'epipen')::boolean AS epipen
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
			LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
			JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
			WHERE fs.form_type = 'fiche_sante'
			AND (fs.submission_data->>'allergie' IS NOT NULL AND fs.submission_data->>'allergie' != '')
			ORDER BY g.name, p.last_name, p.first_name`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error generating allergies report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get medication report - medication information for participants with medications
 */
exports.getMedicationReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				p.first_name || ' ' || p.last_name AS name,
				g.name AS group_name,
				fs.submission_data->>'medicament' AS medication
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
			LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1 
			JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
			WHERE fs.form_type = 'fiche_sante'
			AND (fs.submission_data->>'medicament' IS NOT NULL AND fs.submission_data->>'medicament' != '')
			ORDER BY g.name, p.last_name, p.first_name`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error generating medication report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get vaccine report - vaccination status for all participants
 */
exports.getVaccineReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				p.first_name || ' ' || p.last_name AS name,
				g.name AS group_name,
				(fs.submission_data->>'vaccins_a_jour')::boolean AS vaccines_up_to_date
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
			LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
			JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
			WHERE fs.form_type = 'fiche_sante'
			ORDER BY g.name, p.last_name, p.first_name`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error generating vaccine report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get leave alone report - participants who can/cannot leave alone
 */
exports.getLeaveAloneReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				p.first_name || ' ' || p.last_name AS name,
				g.name AS group_name,
				(fs.submission_data->>'peut_partir_seul')::boolean AS can_leave_alone
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
			LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
			JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
			WHERE fs.form_type = 'participant_registration'
			ORDER BY g.name, p.last_name, p.first_name`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error generating leave alone report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get media authorization report - participants with/without media consent
 */
exports.getMediaAuthorizationReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				p.first_name || ' ' || p.last_name AS name,
				g.name AS group_name,
				(fs.submission_data->>'consentement_photos_videos')::boolean AS media_authorized
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
			LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
			JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
			WHERE fs.form_type = 'participant_registration'
			ORDER BY g.name, p.last_name, p.first_name`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error generating media authorization report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get missing documents report - participants missing required documents
 */
exports.getMissingDocumentsReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				p.first_name || ' ' || p.last_name AS name,
				g.name AS group_name,
				CASE WHEN fs_fiche.id IS NULL THEN 'Fiche Santé' ELSE NULL END AS missing_fiche_sante,
				CASE WHEN fs_risque.id IS NULL THEN 'Acceptation Risque' ELSE NULL END AS missing_acceptation_risque
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
			LEFT JOIN form_submissions fs_fiche ON p.id = fs_fiche.participant_id AND fs_fiche.form_type = 'fiche_sante' AND fs_fiche.organization_id = $1
			LEFT JOIN form_submissions fs_risque ON p.id = fs_risque.participant_id AND fs_risque.form_type = 'acceptation_risque' AND fs_risque.organization_id = $1
			JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
			WHERE (fs_fiche.id IS NULL OR fs_risque.id IS NULL)
			ORDER BY g.name, p.last_name, p.first_name`,
			[organizationId]
		);

		const missingDocuments = result.rows.map((row) => ({
			...row,
			missing_documents: [
				row.missing_fiche_sante,
				row.missing_acceptation_risque
			].filter(Boolean)
		}));

		return jsonResponse(res, true, missingDocuments);
	} catch (error) {
		logger.error(`Error generating missing documents report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get honors report - number of honors received by each participant
 */
exports.getHonorsReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				p.first_name || ' ' || p.last_name AS name,
				g.name AS group_name,
				COUNT(h.id) AS honors_count
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
			LEFT JOIN honors h ON p.id = h.participant_id AND h.organization_id = $1
			JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
			GROUP BY p.id, g.name
			ORDER BY g.name, p.last_name, p.first_name`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error generating honors report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get points report - points earned by each participant, grouped by group
 */
exports.getPointsReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				g.name AS group_name,
				p.first_name || ' ' || p.last_name AS name,
				COALESCE(SUM(pt.value), 0) AS points
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
			LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
			LEFT JOIN points pt ON p.id = pt.participant_id AND pt.organization_id = $1
			JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
			GROUP BY g.id, p.id
			ORDER BY g.name, p.last_name, p.first_name`,
			[organizationId]
		);

		const groupedPoints = result.rows.reduce((acc, row) => {
			if (!acc[row.group_name]) {
				acc[row.group_name] = [];
			}
			acc[row.group_name].push({ name: row.name, points: row.points });
			return acc;
		}, {});

		return jsonResponse(res, true, groupedPoints);
	} catch (error) {
		logger.error(`Error generating points report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get attendance report - participant attendance over a period
 */
exports.getAttendanceReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);
		const endDate = req.query.end_date || new Date().toISOString().split("T")[0];
		const startDate = req.query.start_date || 
			new Date(new Date().setDate(new Date().getDate() - 30))
				.toISOString().split("T")[0];

		// Count total days with attendance records
		const totalDaysResult = await client.query(
			`SELECT COUNT(DISTINCT date) as total_days
			 FROM attendance
			 WHERE date BETWEEN $1 AND $2
			 AND organization_id = $3`,
			[startDate, endDate, organizationId]
		);

		const totalDays = totalDaysResult.rows[0].total_days;

		// Get attendance data with JSON aggregation
		const attendanceDataResult = await client.query(
			`WITH attendance_days AS (
				SELECT DISTINCT date
				FROM attendance
				WHERE date BETWEEN $1 AND $2
				AND organization_id = $3
			),
			attendance_data AS (
				SELECT 
					p.id, 
					p.first_name, 
					p.last_name, 
					g.name AS group_name,
					a.date,
					a.status
				FROM participants p
				INNER JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $3
				INNER JOIN groups g ON pg.group_id = g.id AND g.organization_id = $3
				LEFT JOIN attendance a ON p.id = a.participant_id AND a.organization_id = $3
				WHERE a.date BETWEEN $1 AND $2
			)
			SELECT 
				p.id,
				p.first_name, 
				p.last_name, 
				g.name AS group_name,
				json_agg(json_build_object('date', a.date, 'status', a.status)) AS attendance
			FROM participants p
			INNER JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $3
			INNER JOIN groups g ON pg.group_id = g.id AND g.organization_id = $3
			LEFT JOIN attendance_data a ON p.id = a.id
			GROUP BY p.id, p.first_name, p.last_name, g.name
			ORDER BY g.name, p.last_name, p.first_name`,
			[startDate, endDate, organizationId]
		);

		return jsonResponse(res, true, {
			start_date: startDate,
			end_date: endDate,
			total_days: totalDays,
			attendance_data: attendanceDataResult.rows
		});
	} catch (error) {
		logger.error(`Error generating attendance report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get participant age report - participants with their ages
 */
exports.getParticipantAgeReport = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT p.id, p.first_name, p.last_name, p.date_naissance, 
							EXTRACT(YEAR FROM AGE(p.date_naissance)) AS age
			 FROM participants p
			 JOIN participant_organizations po ON p.id = po.participant_id
			 WHERE po.organization_id = $1
			 ORDER BY p.date_naissance ASC, p.last_name`,
			[organizationId]
		);

		return jsonResponse(res, true, result.rows);
	} catch (error) {
		logger.error(`Error generating participant age report: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get parent contact list - contact information for parents
 */
exports.getParentContactList = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		const result = await client.query(
			`SELECT 
				p.id, 
				p.first_name, 
				p.last_name,
				COALESCE(g.name, 'no_group') AS group_name,
				pg.nom, 
				pg.prenom, 
				pg.telephone_residence, 
				pg.telephone_cellulaire, 
				pg.telephone_travail,
				pg.is_emergency_contact,
				pg.is_primary
			 FROM participants p
			 LEFT JOIN participant_groups pgroups ON p.id = pgroups.participant_id 
						AND pgroups.organization_id = $1
			 LEFT JOIN groups g ON pgroups.group_id = g.id
			 LEFT JOIN participant_guardians pgp ON p.id = pgp.participant_id
			 LEFT JOIN parents_guardians pg ON pgp.guardian_id = pg.id
			 WHERE pgroups.organization_id = $1
			 ORDER BY p.first_name, p.last_name, pg.is_primary DESC`,
			[organizationId]
		);

		// Organize data by child
		const children = result.rows.reduce((acc, row) => {
			const childId = row.id;
			if (!acc[childId]) {
				acc[childId] = {
					name: `${row.first_name} ${row.last_name}`,
					groups: [],
					contacts: []
				};
			}

			// Add group if not already present
			if (!acc[childId].groups.includes(row.group_name)) {
				acc[childId].groups.push(row.group_name);
			}

			// Only add unique contact entries
			if (row.nom && row.prenom) {
				const contactEntry = {
					name: `${row.prenom} ${row.nom}`,
					phone_home: row.telephone_residence,
					phone_cell: row.telephone_cellulaire,
					phone_work: row.telephone_travail,
					is_emergency: row.is_emergency_contact
				};

				if (!acc[childId].contacts.some(c => 
						c.name === contactEntry.name && 
						c.phone_home === contactEntry.phone_home)) {
					acc[childId].contacts.push(contactEntry);
				}
			}

			return acc;
		}, {});

		return jsonResponse(res, true, children);
	} catch (error) {
		logger.error(`Error generating parent contact list: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

/**
 * Get mailing list - email contacts for the organization
 */
exports.getMailingList = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = getOrganizationId(req);

		// Get emails and roles from user_organizations
		const usersEmailsResult = await client.query(
			`SELECT u.email, uo.role 
			 FROM user_organizations uo
			 JOIN users u ON u.id = uo.user_id
			 WHERE uo.organization_id = $1
			 AND u.email IS NOT NULL 
			 AND u.email != ''`,
			[organizationId]
		);

		// Organize emails by role
		const emailsByRole = usersEmailsResult.rows.reduce((acc, user) => {
			const role = user.role;
			const email = user.email.toLowerCase();
			if (!acc[role]) acc[role] = [];
			acc[role].push(email);
			return acc;
		}, {});

		// Get guardian emails with linked participants
		const parentEmailsResult = await client.query(
			`SELECT 
				LOWER(fs.submission_data->>'guardian_courriel_0') AS courriel, 
				string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
			 FROM form_submissions fs
			 JOIN participants p ON fs.participant_id = p.id
			 WHERE (fs.submission_data->>'guardian_courriel_0') IS NOT NULL 
			 AND (fs.submission_data->>'guardian_courriel_0') != ''
			 AND fs.organization_id = $1
			 GROUP BY fs.submission_data->>'guardian_courriel_0'
			 UNION
			 SELECT 
				LOWER(fs.submission_data->>'guardian_courriel_1') AS courriel, 
				string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
			 FROM form_submissions fs
			 JOIN participants p ON fs.participant_id = p.id
			 WHERE (fs.submission_data->>'guardian_courriel_1') IS NOT NULL 
			 AND (fs.submission_data->>'guardian_courriel_1') != ''
			 AND fs.organization_id = $1
			 GROUP BY fs.submission_data->>'guardian_courriel_1'`,
			[organizationId]
		);

		// Format parent emails with linked participants
		emailsByRole["parent"] = parentEmailsResult.rows.map((parent) => ({
			email: parent.courriel,
			participants: parent.participants
		}));

		// Get participant emails
		const participantEmailsResult = await client.query(
			`SELECT LOWER(fs.submission_data->>'courriel') AS courriel
			 FROM form_submissions fs
			 WHERE (fs.submission_data->>'courriel') IS NOT NULL 
			 AND (fs.submission_data->>'courriel') != ''
			 AND fs.organization_id = $1`,
			[organizationId]
		);

		// Get all unique emails
		const allEmails = [
			...new Set([
				...Object.values(emailsByRole).flat(),
				...participantEmailsResult.rows.map((row) => row.courriel)
			])
		];

		return jsonResponse(res, true, {
			emails_by_role: emailsByRole,
			participant_emails: participantEmailsResult.rows.map(
				(row) => row.courriel
			),
			unique_emails: allEmails
		});
	} catch (error) {
		logger.error(`Error generating mailing list: ${error.message}`);
		return jsonResponse(res, false, null, error.message);
	} finally {
		client.release();
	}
};

module.exports = exports;