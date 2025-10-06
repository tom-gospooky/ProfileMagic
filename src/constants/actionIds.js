/**
 * Constants for Slack action IDs used throughout the application
 */

module.exports = {
  // Approval actions
  APPROVE_EDIT: 'approve_edit',
  APPROVE_EDIT_MESSAGE: 'approve_edit_message',
  APPROVE_EXTENDED: 'approve_extended',

  // Retry actions
  RETRY_SAME: 'retry_same',
  RETRY_DIRECT: 'retry_direct',
  RETRY_EDIT: 'retry_edit',

  // Modal actions
  OPEN_SHARE_MODAL: 'open_share_modal',
  OPEN_ADVANCED_MODAL: 'open_advanced_modal',

  // File selection
  FILE_SELECTION_MODAL: 'file_selection_modal',
  PROFILE_ONLY_MODAL: 'profile_only_modal',

  // Submission actions
  SHARE_TO_CHANNEL_SUBMISSION: 'share_to_channel_submission',
  EXTENDED_SUBMISSION: 'extended_submission',
};
