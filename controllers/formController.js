// controllers/formController.js
const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const logger = require('../config/logger');

/**
 * Get all available form types for an organization
 */
exports.getFormTypes = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = req.user.organizationId;

		const formTypesResult = await client.query(
			"SELECT DISTINCT form_type FROM organization_form_formats WHERE organization_id = $1 AND display_type = 'public'",
			[organizationId]
		);

		const formTypes = formTypesResult.rows.map(row => row.form_type);
		return jsonResponse(res, true, formTypes);
	} catch (error) {
		logger.error(`Error fetching form types: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving form types");
	} finally {
		client.release();
	}
};

/**
 * Get the structure for a specific form type
 */
exports.getFormStructure = async (req, res) => {
	const client = await pool.connect();
	try {
		const { form_type } = req.query;
		const organizationId = req.user.organizationId;

		if (!form_type) {
			return jsonResponse(res, false, null, "Form type is required");
		}

		const formStructureResult = await client.query(
			"SELECT form_structure FROM organization_form_formats WHERE form_type = $1 AND organization_id = $2",
			[form_type, organizationId]
		);

		if (formStructureResult.rows.length > 0) {
			const formStructure = JSON.parse(formStructureResult.rows[0].form_structure);
			return jsonResponse(res, true, formStructure);
		} else {
			return jsonResponse(res, false, null, "Form structure not found");
		}
	} catch (error) {
		logger.error(`Error retrieving form structure: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving form structure");
	} finally {
		client.release();
	}
};

/**
 * Save a form submission
 */
exports.saveFormSubmission = async (req, res) => {
	const client = await pool.connect();
	try {
		const { form_type, participant_id, submission_data } = req.body;
		const userId = req.user.id;
		const organizationId = req.user.organizationId;

		if (!form_type || !participant_id || !submission_data) {
			return jsonResponse(res, false, null, "Missing required fields");
		}

		await client.query(
			`INSERT INTO form_submissions 
			 (organization_id, user_id, participant_id, form_type, submission_data)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (participant_id, form_type, organization_id)
			 DO UPDATE SET 
					submission_data = EXCLUDED.submission_data, 
					updated_at = CURRENT_TIMESTAMP`,
			[
				organizationId,
				userId,
				participant_id,
				form_type,
				JSON.stringify(submission_data)
			]
		);

		return jsonResponse(res, true, null, "Form submission saved successfully");
	} catch (error) {
		logger.error(`Error saving form submission: ${error.message}`);
		return jsonResponse(
			res,
			false,
			null,
			`Error saving form submission: ${error.message}`
		);
	} finally {
		client.release();
	}
};

/**
 * Get a specific form submission
 */
exports.getFormSubmission = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id, form_type } = req.query;
		const userId = req.user.id;
		const organizationId = req.user.organizationId;

		if (!participant_id || !form_type) {
			return jsonResponse(
				res,
				false,
				null,
				"Invalid participant ID or form type"
			);
		}

		// Check user's permission to access participant data
		const hasAccess = await userHasAccessToParticipant(
			client,
			userId,
			participant_id
		);

		if (!hasAccess) {
			return jsonResponse(
				res,
				false,
				null,
				"You do not have permission to access this participant's data"
			);
		}

		const result = await client.query(
			`SELECT fs.submission_data
			 FROM form_submissions fs
			 WHERE fs.participant_id = $1 
			 AND fs.form_type = $2
			 AND fs.organization_id = $3
			 ORDER BY fs.created_at DESC
			 LIMIT 1`,
			[participant_id, form_type, organizationId]
		);

		if (result.rows.length > 0) {
			const formData = JSON.parse(result.rows[0].submission_data);
			return jsonResponse(res, true, {
				form_data: formData,
				form_type: form_type,
				participant_id: participant_id
			});
		} else {
			return jsonResponse(res, false, null, "Form submission not found");
		}
	} catch (error) {
		logger.error(`Error fetching form submission: ${error.message}`);
		return jsonResponse(
			res,
			false,
			null,
			"An error occurred while fetching the form submission"
		);
	} finally {
		client.release();
	}
};

/**
 * Get all form submissions for a particular form type
 */
exports.getAllFormSubmissions = async (req, res) => {
	const client = await pool.connect();
	try {
		const { form_type } = req.query;
		const organizationId = req.user.organizationId;

		if (!form_type) {
			return jsonResponse(res, false, null, "Form type is required");
		}

		const result = await client.query(
			`SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name 
			 FROM form_submissions fs 
			 JOIN participant_organizations po ON fs.participant_id = po.participant_id 
			 JOIN participants p ON fs.participant_id = p.id 
			 WHERE po.organization_id = $1 AND fs.form_type = $2`,
			[organizationId, form_type]
		);

		const submissions = result.rows.map(row => ({
			participant_id: row.participant_id,
			first_name: row.first_name,
			last_name: row.last_name,
			submission_data: JSON.parse(row.submission_data)
		}));

		return jsonResponse(res, true, submissions);
	} catch (error) {
		logger.error(`Error fetching form submissions: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving form submissions");
	} finally {
		client.release();
	}
};

/**
 * Get organization form formats
 */
exports.getOrganizationFormFormats = async (req, res) => {
	const client = await pool.connect();
	try {
		const organizationId = req.query.organization_id || req.user.organizationId;

		const formFormatsResult = await client.query(
			`SELECT form_type, form_structure 
			 FROM organization_form_formats 
			 WHERE organization_id = $1`,
			[organizationId]
		);

		const formFormats = formFormatsResult.rows.reduce((acc, form) => {
			acc[form.form_type] = JSON.parse(form.form_structure);
			return acc;
		}, {});

		return jsonResponse(res, true, formFormats);
	} catch (error) {
		logger.error(`Error fetching form formats: ${error.message}`);
		return jsonResponse(res, false, null, "Error retrieving form formats");
	} finally {
		client.release();
	}
};

/**
 * Get health record form (Fiche Santé)
 */
exports.getFicheSante = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id } = req.query;

		if (!participant_id) {
			return jsonResponse(res, false, null, "Invalid participant ID");
		}

		const result = await client.query(
			"SELECT * FROM fiche_sante WHERE participant_id = $1",
			[participant_id]
		);

		if (result.rows.length > 0) {
			return jsonResponse(res, true, result.rows[0]);
		} else {
			return jsonResponse(res, false, null, "Fiche sante not found");
		}
	} catch (error) {
		logger.error(`Error fetching fiche sante: ${error.message}`);
		return jsonResponse(res, false, null, "Error fetching fiche sante");
	} finally {
		client.release();
	}
};

/**
 * Save health record form (Fiche Santé)
 */
exports.saveFicheSante = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id, ...ficheSanteData } = req.body;

		if (!participant_id) {
			return jsonResponse(res, false, null, "Participant ID is required");
		}

		await client.query("BEGIN");

		// Check if fiche sante exists
		const existingResult = await client.query(
			"SELECT id FROM fiche_sante WHERE participant_id = $1",
			[participant_id]
		);

		if (existingResult.rows.length > 0) {
			// Update existing record
			const fieldNames = Object.keys(ficheSanteData);
			const placeholders = fieldNames.map((_, index) => `$${index + 1}`).join(', ');
			const setClause = fieldNames.map((field, index) => `${field} = $${index + 1}`).join(', ');

			await client.query(
				`UPDATE fiche_sante SET ${setClause} WHERE participant_id = $${fieldNames.length + 1}`,
				[...Object.values(ficheSanteData), participant_id]
			);
		} else {
			// Insert new record
			const fieldNames = Object.keys(ficheSanteData);
			const placeholders = fieldNames.map((_, index) => `$${index + 1}`).join(', ');

			await client.query(
				`INSERT INTO fiche_sante (
					${fieldNames.join(', ')}, participant_id
				) VALUES (${placeholders}, $${fieldNames.length + 1})`,
				[...Object.values(ficheSanteData), participant_id]
			);
		}

		await client.query("COMMIT");
		return jsonResponse(res, true, null, "Fiche sante saved successfully");
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Error saving fiche sante: ${error.message}`);
		return jsonResponse(
			res,
			false,
			null,
			`Error saving fiche sante: ${error.message}`
		);
	} finally {
		client.release();
	}
};

/**
 * Get risk acceptance form
 */
exports.getAcceptationRisque = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id } = req.query;

		if (!participant_id) {
			return jsonResponse(res, false, null, "Invalid participant ID");
		}

		const result = await client.query(
			"SELECT * FROM acceptation_risque WHERE participant_id = $1",
			[participant_id]
		);

		if (result.rows.length > 0) {
			return jsonResponse(res, true, { acceptation_risque: result.rows[0] });
		} else {
			return jsonResponse(res, false, null, "Acceptation risque not found");
		}
	} catch (error) {
		logger.error(`Error fetching acceptation risque: ${error.message}`);
		return jsonResponse(res, false, null, "Error fetching acceptation risque");
	} finally {
		client.release();
	}
};

/**
 * Save risk acceptance form
 */
exports.saveAcceptationRisque = async (req, res) => {
	const client = await pool.connect();
	try {
		const {
			participant_id,
			groupe_district,
			accepte_risques,
			accepte_covid19,
			participation_volontaire,
			declaration_sante,
			declaration_voyage,
			nom_parent_tuteur,
			date_signature
		} = req.body;

		if (!participant_id) {
			return jsonResponse(res, false, null, "Participant ID is required");
		}

		const saveAcceptationRisqueResult = await client.query(
			`INSERT INTO acceptation_risque 
			 (participant_id, groupe_district, accepte_risques, accepte_covid19, 
				participation_volontaire, declaration_sante, declaration_voyage, 
				nom_parent_tuteur, date_signature) 
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
			 ON CONFLICT (participant_id) DO UPDATE SET 
			 groupe_district = EXCLUDED.groupe_district, 
			 accepte_risques = EXCLUDED.accepte_risques, 
			 accepte_covid19 = EXCLUDED.accepte_covid19, 
			 participation_volontaire = EXCLUDED.participation_volontaire, 
			 declaration_sante = EXCLUDED.declaration_sante, 
			 declaration_voyage = EXCLUDED.declaration_voyage, 
			 nom_parent_tuteur = EXCLUDED.nom_parent_tuteur, 
			 date_signature = EXCLUDED.date_signature`,
			[
				participant_id,
				groupe_district,
				accepte_risques,
				accepte_covid19,
				participation_volontaire,
				declaration_sante,
				declaration_voyage,
				nom_parent_tuteur,
				date_signature
			]
		);

		if (saveAcceptationRisqueResult.rowCount > 0) {
			return jsonResponse(res, true, null, "Acceptation risque saved successfully");
		} else {
			return jsonResponse(res, false, null, "Failed to save acceptation risque");
		}
	} catch (error) {
		logger.error(`Error saving acceptation risque: ${error.message}`);
		return jsonResponse(res, false, null, "Error saving acceptation risque");
	} finally {
		client.release();
	}
};

/**
 * Save guardian form submission
 */
exports.saveGuardianFormSubmission = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id, submission_data } = req.body;
		const userId = req.user.id;

		if (!participant_id || !submission_data) {
			return jsonResponse(res, false, null, "Missing required fields");
		}

		await client.query("BEGIN");

		// Check for existing guardian
		const existingGuardian = await client.query(
			`SELECT * FROM parents_guardians 
			 WHERE participant_id = $1 
			 AND nom = $2 
			 AND prenom = $3
			 AND courriel = $4`,
			[
				participant_id,
				submission_data.nom,
				submission_data.prenom,
				submission_data.courriel
			]
		);

		let guardianId;
		if (existingGuardian.rows.length > 0) {
			// Update existing guardian
			await client.query(
				`UPDATE parents_guardians
				 SET lien = $1, 
						 telephone_residence = $2, 
						 telephone_travail = $3, 
						 telephone_cellulaire = $4, 
						 is_primary = $5, 
						 is_emergency_contact = $6
				 WHERE id = $7`,
				[
					submission_data.lien,
					submission_data.telephone_residence,
					submission_data.telephone_travail,
					submission_data.telephone_cellulaire,
					submission_data.is_primary,
					submission_data.is_emergency_contact,
					existingGuardian.rows[0].id
				]
			);
			guardianId = existingGuardian.rows[0].id;
		} else {
			// Insert new guardian
			const newGuardian = await client.query(
				`INSERT INTO parents_guardians 
				 (participant_id, nom, prenom, lien, courriel, 
					telephone_residence, telephone_travail, telephone_cellulaire, 
					is_primary, is_emergency_contact, user_id)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				 RETURNING id`,
				[
					participant_id,
					submission_data.nom,
					submission_data.prenom,
					submission_data.lien,
					submission_data.courriel,
					submission_data.telephone_residence,
					submission_data.telephone_travail,
					submission_data.telephone_cellulaire,
					submission_data.is_primary,
					submission_data.is_emergency_contact,
					userId
				]
			);
			guardianId = newGuardian.rows[0].id;
		}

		// Link guardian to participant
		await client.query(
			`INSERT INTO participant_guardians (participant_id, guardian_id)
			 VALUES ($1, $2)
			 ON CONFLICT (participant_id, guardian_id) DO NOTHING`,
			[participant_id, guardianId]
		);

		await client.query("COMMIT");
		return jsonResponse(res, true, null, "Guardian saved successfully");
	} catch (error) {
		await client.query("ROLLBACK");
		logger.error(`Error saving guardian: ${error.message}`);
		return jsonResponse(
			res,
			false,
			null,
			`Error saving guardian: ${error.message}`
		);
	} finally {
		client.release();
	}
};

/**
 * Get guardians for a participant
 */
exports.getGuardians = async (req, res) => {
	const client = await pool.connect();
	try {
		const { participant_id } = req.query;

		if (!participant_id) {
			return jsonResponse(res, false, null, "Missing participant_id parameter.");
		}

		const guardianInfoResult = await client.query(
			"SELECT guardian_id, lien FROM participant_guardians WHERE participant_id = $1",
			[participant_id]
		);

		const guardianInfo = guardianInfoResult.rows;

		if (guardianInfo.length > 0) {
			const guardianIds = guardianInfo.map(row => row.guardian_id);
			const lienInfo = guardianInfo.reduce((acc, row) => {
				acc[row.guardian_id] = row.lien;
				return acc;
			}, {});

			const guardianDetailsResult = await client.query(
				`SELECT id, nom, prenom, courriel, telephone_residence, telephone_travail, 
								telephone_cellulaire, is_primary, is_emergency_contact
				 FROM parents_guardians
				 WHERE id = ANY($1::int[])`,
				[guardianIds]
			);

			const guardians = guardianDetailsResult.rows;

			const customFormFormatResult = await client.query(
				"SELECT form_structure FROM organization_form_formats WHERE form_type = 'parent_guardian' AND organization_id = $1",
				[req.user.organizationId]
			);

			const customFormFormat = customFormFormatResult.rows[0]?.form_structure;

			const mergedData = guardians.map(guardian => ({
				...guardian,
				lien: lienInfo[guardian.id],
				custom_form: customFormFormat ? JSON.parse(customFormFormat) : null
			}));

			return jsonResponse(res, true, mergedData);
		} else {
			return jsonResponse(res, false, null, "No guardians found for this participant.");
		}
	} catch (error) {
		logger.error(`Error fetching guardians: ${error.message}`);
		return jsonResponse(res, false, null, "Error fetching guardians");
	} finally {
		client.release();
	}
};

/**
 * Check if a user has access to a participant's data
 */
async function userHasAccessToParticipant(client, userId, participantId) {
	try {
		const result = await client.query(
			`SELECT 1 FROM user_participants 
			 WHERE user_id = $1 AND participant_id = $2
			 UNION
			 SELECT 1 FROM user_organizations uo
			 JOIN participant_organizations po ON uo.organization_id = po.organization_id
			 WHERE uo.user_id = $1 AND po.participant_id = $2 AND uo.role IN ('admin', 'animation')`,
			[userId, participantId]
		);
		return result.rows.length > 0;
	} catch (error) {
		logger.error(`Error checking user access to participant: ${error.message}`);
		return false;
	}
}

module.exports = exports;