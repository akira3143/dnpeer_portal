import { SessionService } from '../services/sessionService.js';
import { ScannerService } from '../services/scannerService.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';

export class SessionController {
  static async listSessions(user) {
    if (!user) {
      return errorEnvelope('Unauthorized', null, 401);
    }
    const isAdmin = user.role === 'admin';
    const sessions = await SessionService.getSessionsByAsn(user.asn, isAdmin);
    return successEnvelope(sessions, 200);
  }

  static async deleteSession(sessionId, user) {
    if (!user) {
      return errorEnvelope('Unauthorized', null, 401);
    }
    const isAdmin = user.role === 'admin';
    const result = await SessionService.deleteSession(sessionId, user.asn, isAdmin);
    if (!result.success) {
      return errorEnvelope(result.message, null, 200);
    }
    return successEnvelope({ message: result.message }, 200);
  }

  static async syncMaster(user) {
    if (!user || user.role !== 'admin') {
      return errorEnvelope('Forbidden: Admin privilege required', null, 403);
    }
    const result = await ScannerService.performMasterSync();
    return successEnvelope(result, 200);
  }
}
