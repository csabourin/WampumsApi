// routes/api.js
const express = require('express');
const { check } = require('express-validator');
const { validateRequest, roleMiddleware } = require('../config/middleware');

// Controllers
const authController = require('../controllers/authController');
const participantController = require('../controllers/participantController');
const guardianController = require('../controllers/guardianController');
const groupController = require('../controllers/groupController');
const formController = require('../controllers/formController');
const badgeController = require('../controllers/badgeController');
const honorController = require('../controllers/honorController');
const attendanceController = require('../controllers/attendanceController');
const calendarController = require('../controllers/calendarController');
const reunionController = require('../controllers/reunionController');
const reportController = require('../controllers/reportController');
const organizationController = require('../controllers/organizationController');
const utilityController = require('../controllers/utilityController');

const router = express.Router();

// Authentication routes
router.post('/login', [
	check('email').isEmail().normalizeEmail(),
	check('password').notEmpty(),
	validateRequest
], authController.login);

router.post('/register', [
	check('email').isEmail().normalizeEmail(),
	check('password').isLength({ min: 8 }),
	check('full_name').notEmpty().trim(),
	check('account_creation_password').notEmpty(),
	check('user_type').isIn(['parent', 'animation', 'admin']),
	validateRequest
], authController.register);

router.post('/verify-email', [
	check('verification_token').notEmpty(),
	validateRequest
], authController.verifyEmail);

router.post('/request-reset', [
	check('email').isEmail().normalizeEmail(),
	validateRequest
], authController.requestReset);

router.post('/reset-password', [
	check('reset_token').notEmpty(),
	check('new_password').isLength({ min: 8 }),
	validateRequest
], authController.resetPassword);

router.post('/logout', authController.logout);

// Users and permissions
router.get('/users', authController.getUsers);
router.post('/check-permission', authController.checkPermission);
router.post('/approve-user', [
	check('user_id').notEmpty(),
	validateRequest,
	roleMiddleware(['admin'])
], authController.approveUser);
router.post('/update-user-role', [
	check('user_id').notEmpty(),
	check('new_role').isIn(['parent', 'animation', 'admin']),
	validateRequest,
	roleMiddleware(['admin'])
], authController.updateUserRole);

// Participant routes
router.get('/participants', participantController.getParticipants);
router.get('/participant/:id', participantController.getParticipant);
router.get('/participant-details', participantController.getParticipantDetails);
router.post('/save-participant', [
	check('first_name').notEmpty().trim(),
	check('last_name').notEmpty().trim(),
	check('date_naissance').isDate(),
	validateRequest
], participantController.saveParticipant);
router.get('/participant-age', participantController.getParticipantAgeReport);
router.get('/participants-with-users', participantController.getParticipantsWithUsers);
router.post('/link-participant-to-organization', [
	check('participant_id').notEmpty(),
	validateRequest
], participantController.linkParticipantToOrganization);
router.post('/remove-participant-from-organization', [
	check('participant_id').notEmpty(),
	validateRequest,
	roleMiddleware(['admin'])
], participantController.removeParticipantFromOrganization);
router.post('/associate-user', [
	check('participant_id').notEmpty(),
	check('user_id').notEmpty(),
	validateRequest
], participantController.associateUser);
router.post('/link-user-participants', [
	check('participant_ids').isArray(),
	validateRequest
], participantController.linkUserParticipants);

// Guardian routes
router.get('/guardians', guardianController.getGuardians);
router.get('/guardian-info', guardianController.getGuardianInfo);
router.get('/guardians-for-participant', guardianController.getGuardiansForParticipant);
router.post('/save-parent', [
	check('participant_id').notEmpty(),
	validateRequest
], guardianController.saveParent);
router.post('/save-guardian-form-submission', [
	check('participant_id').notEmpty(),
	check('submission_data').notEmpty(),
	validateRequest
], guardianController.saveGuardianFormSubmission);
router.post('/link-parent-to-participant', [
	check('parent_id').notEmpty(),
	check('participant_id').notEmpty(),
	validateRequest
], guardianController.linkParentToParticipant);
router.post('/remove-guardians', [
	check('participant_id').notEmpty(),
	check('guardian_ids').isArray(),
	validateRequest
], guardianController.removeGuardians);
router.get('/parent-users', guardianController.getParentUsers);
router.get('/parent-dashboard-data', guardianController.getParentDashboardData);
router.get('/parent-contact-list', guardianController.getParentContactList);

// Group routes
router.get('/groups', groupController.getGroups);
router.post('/add-group', [
	check('group_name').notEmpty().trim(),
	validateRequest
], groupController.addGroup);
router.post('/remove-group', [
	check('group_id').notEmpty(),
	validateRequest
], groupController.removeGroup);
router.post('/update-group-name', [
	check('group_id').notEmpty(),
	check('group_name').notEmpty().trim(),
	validateRequest
], groupController.updateGroupName);
router.post('/update-participant-group', [
	check('participant_id').notEmpty(),
	validateRequest
], groupController.updateParticipantGroup);
router.post('/update-points', [
	check('type').isIn(['group', 'individual']),
	check('id').notEmpty(),
	check('points').isNumeric(),
	check('timestamp').isISO8601(),
	validateRequest
], groupController.updatePoints);
router.get('/points-report', groupController.getPointsReport);

// Form routes
router.get('/form-types', formController.getFormTypes);
router.get('/form-structure', formController.getFormStructure);
router.get('/form-submission', formController.getFormSubmission);
router.get('/form-submissions', formController.getAllFormSubmissions);
router.post('/save-form-submission', [
	check('form_type').notEmpty(),
	check('participant_id').notEmpty(),
	check('submission_data').notEmpty(),
	validateRequest
], formController.saveFormSubmission);
router.get('/organization-form-formats', formController.getOrganizationFormFormats);
router.get('/fiche-sante', formController.getFicheSante);
router.post('/save-fiche-sante', [
	check('participant_id').notEmpty(),
	validateRequest
], formController.saveFicheSante);
router.get('/acceptation-risque', formController.getAcceptationRisque);
router.post('/save-acceptation-risque', [
	check('participant_id').notEmpty(),
	validateRequest
], formController.saveAcceptationRisque);

// Badge routes
router.get('/badge-progress', badgeController.getBadgeProgress);
router.post('/save-badge-progress', [
	check('participant_id').notEmpty(),
	check('territoire_chasse').notEmpty(),
	validateRequest
], badgeController.saveBadgeProgress);
router.get('/pending-badges', badgeController.getPendingBadges);
router.get('/current-stars', badgeController.getCurrentStars);
router.post('/approve-badge', [
	check('badge_id').notEmpty(),
	validateRequest
], badgeController.approveBadge);
router.post('/reject-badge', [
	check('badge_id').notEmpty(),
	validateRequest
], badgeController.rejectBadge);
router.get('/badge-summary', badgeController.getBadgeSummary);
router.get('/badge-history', badgeController.getBadgeHistory);

// Honor routes
router.get('/honors', honorController.getHonors);
router.get('/recent-honors', honorController.getRecentHonors);
router.post('/award-honor', [
	check('participantId').notEmpty(),
	check('date').isISO8601(),
	validateRequest
], honorController.awardHonor);
router.get('/honors-report', honorController.getHonorsReport);
router.get('/available-dates', honorController.getAvailableDates);

// Attendance routes
router.get('/attendance', attendanceController.getAttendance);
router.post('/update-attendance', [
	check('participant_id').notEmpty(),
	check('status').isIn(['present', 'absent', 'excused', 'late', 'non-motivated']),
	check('date').isISO8601(),
	validateRequest
], attendanceController.updateAttendance);
router.get('/attendance-dates', attendanceController.getAttendanceDates);
router.get('/attendance-report', attendanceController.getAttendanceReport);
router.post('/save-guest', [
	check('name').notEmpty().trim(),
	check('attendance_date').isISO8601(),
	validateRequest
], attendanceController.saveGuest);
router.get('/guests-by-date', attendanceController.getGuestsByDate);

// Calendar routes
router.get('/calendars', calendarController.getCalendars);
router.post('/update-calendar', [
	check('participant_id').notEmpty(),
	check('amount').isNumeric(),
	validateRequest
], calendarController.updateCalendar);
router.post('/update-calendar-paid', [
	check('participant_id').notEmpty(),
	check('paid_status').isBoolean(),
	validateRequest
], calendarController.updateCalendarPaid);
router.post('/update-calendar-amount-paid', [
	check('participant_id').notEmpty(),
	check('amount_paid').isNumeric(),
	validateRequest
], calendarController.updateCalendarAmountPaid);
router.get('/participant-calendar', calendarController.getParticipantCalendar);

// Reunion routes
router.get('/reunion-preparation', reunionController.getReunionPreparation);
router.post('/save-reunion-preparation', [
	check('date').isISO8601(),
	validateRequest
], reunionController.saveReunionPreparation);
router.get('/reunion-dates', reunionController.getReunionDates);
router.get('/activites-rencontre', utilityController.getActivitesRencontre);
router.post('/save-reminder', [
	check('reminder_date').isISO8601(),
	check('reminder_text').notEmpty(),
	validateRequest
], reunionController.saveReminder);
router.get('/reminder', reunionController.getReminder);
router.get('/next-meeting-info', reunionController.getNextMeetingInfo);
router.get('/animateurs', utilityController.getAnimateurs);

// Report routes
router.get('/health-contact-report', reportController.getHealthContactReport);
router.get('/health-report', reportController.getHealthReport);
router.get('/allergies-report', reportController.getAllergiesReport);
router.get('/medication-report', reportController.getMedicationReport);
router.get('/vaccine-report', reportController.getVaccineReport);
router.get('/leave-alone-report', reportController.getLeaveAloneReport);
router.get('/media-authorization-report', reportController.getMediaAuthorizationReport);
router.get('/missing-documents-report', reportController.getMissingDocumentsReport);
router.get('/mailing-list', reportController.getMailingList);

// Organization routes
router.get('/get-organization-id', organizationController.getOrganizationId);
router.post('/create-organization', [
	check('name').notEmpty().trim(),
	validateRequest
], organizationController.createOrganization);
router.post('/switch-organization', [
	check('organization_id').notEmpty(),
	validateRequest
], utilityController.switchOrganization);
router.get('/organization-settings', utilityController.getOrganizationSettings);
router.get('/news', utilityController.getNews);

// Utility routes
router.get('/test-connection', utilityController.testConnection);
router.get('/initial-data', utilityController.getInitialData);
router.get('/subscribers', utilityController.getSubscribers);

module.exports = router;