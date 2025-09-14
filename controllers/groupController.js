/*
get_groups: Getting all groups
add_group: Adding a new group
remove_group: Removing a group
update_group_name: Updating a group's name
update_participant_group: Updating a participant's group assignment
update_points: Updating points for groups and individuals
*/

// controllers/groupController.js
const { pool } = require('../config/database');
const { jsonResponse } = require('../utils/responseFormatter');
const { getOrganizationId } = require('../utils/organizationContext');
const logger = require('../config/logger');

/**
 * Get all groups for an organization
 */
exports.getGroups = async (req, res) => {
        const client = await pool.connect();
        try {
                const organizationId = getOrganizationId(req);

                const result = await client.query(
                        `SELECT 
                                g.id,
                                g.name,
                                COALESCE(SUM(pt.value), 0) AS total_points
                         FROM groups g
                         LEFT JOIN points pt ON pt.group_id = g.id AND pt.organization_id = $1
                         WHERE g.organization_id = $1
                         GROUP BY g.id, g.name
                         ORDER BY g.name`,
                        [organizationId]
                );

                return jsonResponse(res, true, { groups: result.rows });
        } catch (error) {
                logger.error(`Error fetching groups: ${error.message}`);
                return jsonResponse(res, false, null, error.message);
        } finally {
                client.release();
        }
};

/**
 * Add a new group
 */
exports.addGroup = async (req, res) => {
        const client = await pool.connect();
        try {
                const { group_name } = req.body;
                const organizationId = getOrganizationId(req);

                if (!group_name || group_name.trim() === '') {
                        return jsonResponse(res, false, null, "Group name is required");
                }

                await client.query(
                        `INSERT INTO groups (name, organization_id) 
                         VALUES ($1, $2)`,
                        [group_name.trim(), organizationId]
                );

                return jsonResponse(res, true, null, "Group added successfully");
        } catch (error) {
                logger.error(`Error adding group: ${error.message}`);
                return jsonResponse(res, false, null, error.message);
        } finally {
                client.release();
        }
};

/**
 * Remove a group
 */
exports.removeGroup = async (req, res) => {
        const client = await pool.connect();
        try {
                const { group_id } = req.body;

                if (!group_id) {
                        return jsonResponse(res, false, null, "Group ID is required");
                }

                await client.query("BEGIN");

                // Update all participants in this group to have no group
                await client.query(
                        `UPDATE participants 
                         SET group_id = NULL 
                         WHERE group_id = $1`,
                        [group_id]
                );

                // Remove group participants
                await client.query(
                        `DELETE FROM participant_groups
                         WHERE group_id = $1`,
                        [group_id]
                );

                // Delete the group
                await client.query(
                        `DELETE FROM groups 
                         WHERE id = $1`,
                        [group_id]
                );

                await client.query("COMMIT");
                return jsonResponse(res, true, null, "Group removed successfully");
        } catch (error) {
                await client.query("ROLLBACK");
                logger.error(`Error removing group: ${error.message}`);
                return jsonResponse(res, false, null, error.message);
        } finally {
                client.release();
        }
};

/**
 * Update a group's name
 */
exports.updateGroupName = async (req, res) => {
        const client = await pool.connect();
        try {
                const { group_id, group_name } = req.body;

                if (!group_id || !group_name) {
                        return jsonResponse(res, false, null, "Missing group ID or name");
                }

                const sanitizedGroupName = group_name.trim();
                const groupId = parseInt(group_id);

                if (isNaN(groupId)) {
                        return jsonResponse(res, false, null, "Invalid group ID");
                }

                const updateResult = await client.query(
                        "UPDATE groups SET name = $1 WHERE id = $2 RETURNING id, name",
                        [sanitizedGroupName, groupId]
                );

                if (updateResult.rowCount === 0) {
                        return jsonResponse(res, false, null, "Group not found");
                }

                return jsonResponse(
                        res,
                        true,
                        { group: updateResult.rows[0] },
                        "Group name updated successfully"
                );
        } catch (error) {
                logger.error(`Error updating group name: ${error.message}`);
                return jsonResponse(res, false, null, error.message);
        } finally {
                client.release();
        }
};

/**
 * Update a participant's group assignment
 */
exports.updateParticipantGroup = async (req, res) => {
        const client = await pool.connect();
        try {
                const { participant_id, group_id, is_leader, is_second_leader } = req.body;
                const organizationId = getOrganizationId(req);

                // Validate inputs
                if (!participant_id) {
                        throw new Error("Participant ID is required");
                }

                const parsedGroupId = group_id && group_id !== "none" ? parseInt(group_id) : null;
                const isLeader = Boolean(is_leader);
                const isSecondLeader = Boolean(is_second_leader);

                await client.query("BEGIN");

                // Verify participant exists in organization
                const participantExists = await client.query(
                        `SELECT 1 FROM participant_organizations 
                         WHERE participant_id = $1 AND organization_id = $2`,
                        [participant_id, organizationId]
                );

                if (!participantExists.rows.length) {
                        throw new Error("Participant not found in organization");
                }

                // If group_id provided, verify it exists
                if (parsedGroupId) {
                        const groupExists = await client.query(
                                `SELECT 1 FROM groups 
                                 WHERE id = $1 AND organization_id = $2`,
                                [parsedGroupId, organizationId]
                        );

                        if (!groupExists.rows.length) {
                                throw new Error("Group not found in organization");
                        }
                }

                // Remove existing group assignment
                await client.query(
                        `DELETE FROM participant_groups 
                         WHERE participant_id = $1 AND organization_id = $2`,
                        [participant_id, organizationId]
                );

                // Insert new group assignment if group_id provided
                if (parsedGroupId) {
                        await client.query(
                                `INSERT INTO participant_groups 
                                 (participant_id, group_id, organization_id, is_leader, is_second_leader)
                                 VALUES ($1, $2, $3, $4, $5)`,
                                [
                                        participant_id,
                                        parsedGroupId,
                                        organizationId,
                                        isLeader,
                                        isSecondLeader,
                                ]
                        );
                }

                await client.query("COMMIT");
                return jsonResponse(
                        res,
                        true,
                        {
                                participant_id,
                                group_id: parsedGroupId,
                                is_leader: isLeader,
                                is_second_leader: isSecondLeader,
                        },
                        "Group updated successfully"
                );
        } catch (error) {
                await client.query("ROLLBACK");
                logger.error(`Error updating participant group: ${error.message}`);
                return jsonResponse(res, false, null, error.message);
        } finally {
                client.release();
        }
};

/**
 * Update points for groups or individuals
 */
exports.updatePoints = async (req, res) => {
        const client = await pool.connect();
        try {
                const updates = req.body;
                const organizationId = getOrganizationId(req);
                const responses = [];

                await client.query("BEGIN");

                for (const update of updates) {
                        if (update.type === "group") {
                                // Add points to the group
                                await client.query(
                                        `INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
                                         VALUES (NULL, $1, $2, $3, $4)`,
                                        [update.id, update.points, update.timestamp, organizationId]
                                );

                                // Get all members of the group
                                const membersResult = await client.query(
                                        `SELECT p.id 
                                         FROM participants p
                                         JOIN participant_groups pg ON p.id = pg.participant_id
                                         WHERE pg.group_id = $1 AND pg.organization_id = $2`,
                                        [update.id, organizationId]
                                );

                                // Add points to each member of the group
                                for (const member of membersResult.rows) {
                                        await client.query(
                                                `INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
                                                 VALUES ($1, NULL, $2, $3, $4)`,
                                                [
                                                        member.id,
                                                        update.points,
                                                        update.timestamp,
                                                        organizationId,
                                                ]
                                        );
                                }

                                // Get total points for all members combined
                                const memberTotalsResult = await client.query(
                                        `SELECT
                                                p.id as participant_id,
                                                COALESCE(SUM(pt.value), 0) as individual_points
                                         FROM participants p
                                         JOIN participant_groups pg ON p.id = pg.participant_id
                                         LEFT JOIN points pt ON p.id = pt.participant_id AND pt.organization_id = $2
                                         WHERE pg.group_id = $1 AND pg.organization_id = $2
                                         GROUP BY p.id`,
                                        [update.id, organizationId]
                                );

                                // Calculate total group points (sum of all member points)
                                const totalGroupPoints = memberTotalsResult.rows.reduce(
                                        (sum, member) => sum + parseInt(member.individual_points), 0
                                );

                                responses.push({
                                        type: "group",
                                        id: update.id,
                                        totalPoints: totalGroupPoints,
                                        memberIds: membersResult.rows.map((row) => row.id),
                                        memberTotals: memberTotalsResult.rows.map(member => ({
                                                participantId: member.participant_id,
                                                points: parseInt(member.individual_points)
                                        }))
                                });
                        } else {
                                // Add points to an individual
                                await client.query(
                                        `INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
                                         VALUES ($1, NULL, $2, $3, $4)`,
                                        [update.id, update.points, update.timestamp, organizationId]
                                );

                                // Get total points for the individual
                                const individualTotalResult = await client.query(
                                        `SELECT COALESCE(SUM(value), 0) as total_points 
                                         FROM points 
                                         WHERE participant_id = $1 AND organization_id = $2`,
                                        [update.id, organizationId]
                                );

                                responses.push({
                                        type: "individual",
                                        id: update.id,
                                        totalPoints: individualTotalResult.rows[0].total_points,
                                });
                        }
                }

                await client.query("COMMIT");
                return jsonResponse(res, true, responses);
        } catch (error) {
                await client.query("ROLLBACK");
                logger.error(`Error updating points: ${error.message}`);
                return jsonResponse(res, false, null, error.message);
        } finally {
                client.release();
        }
};

/**
 * Get points report by group
 */
exports.getPointsReport = async (req, res) => {
        const client = await pool.connect();
        try {
                const organizationId = getOrganizationId(req);

                const pointsReportResult = await client.query(
                        `SELECT 
                                g.id AS group_id,
                                g.name AS group_name,
                                p.id AS participant_id,
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

                // Group points by group name
                const groupedPoints = pointsReportResult.rows.reduce((acc, row) => {
                        if (!acc[row.group_name]) {
                                acc[row.group_name] = [];
                        }
                        acc[row.group_name].push({ 
                        participant_id: row.participant_id,
                        group_id: row.group_id,
                        name: row.name, 
                        points: row.points 
                });
                        return acc;
                }, {});

                return jsonResponse(res, true, groupedPoints);
        } catch (error) {
                logger.error(`Error generating points report: ${error.message}`);
                return jsonResponse(res, false, null, "Error generating points report");
        } finally {
                client.release();
        }
};

/**
 * Get participants by group
 */
exports.getParticipantsByGroup = async (req, res) => {
        const client = await pool.connect();
        try {
                const organizationId = getOrganizationId(req);

                const result = await client.query(
                        `SELECT 
                                p.id, 
                                p.first_name, 
                                p.last_name, 
                                COALESCE(SUM(CASE WHEN pt.group_id IS NULL THEN pt.value ELSE 0 END), 0) AS total_points,
                                COALESCE(SUM(CASE WHEN pt.group_id IS NOT NULL THEN pt.value ELSE 0 END), 0) AS group_total_points,
                                pg.group_id,
                                g.name AS group_name,
                                pg.is_leader,
                                pg.is_second_leader
                        FROM participants p
                        JOIN participant_organizations po 
                                ON p.id = po.participant_id 
                                AND po.organization_id = $1
                        LEFT JOIN participant_groups pg 
                                ON p.id = pg.participant_id 
                                AND pg.organization_id = $1
                        LEFT JOIN groups g 
                                ON pg.group_id = g.id 
                                AND g.organization_id = $1
                        LEFT JOIN points pt 
                                ON (p.id = pt.participant_id OR pg.group_id = pt.group_id)
                                AND pt.organization_id = $1
                        GROUP BY p.id, pg.group_id, g.name, pg.is_leader, pg.is_second_leader
                        ORDER BY g.name, p.last_name, p.first_name`,
                        [organizationId]
                );

                return jsonResponse(res, true, { participants: result.rows });
        } catch (error) {
                logger.error(`Error fetching participants by group: ${error.message}`);
                return jsonResponse(res, false, null, "Error fetching participants by group");
        } finally {
                client.release();
        }
};

module.exports = exports;