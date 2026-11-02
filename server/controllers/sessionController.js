import { SessionService } from '../services/sessionService.js';
import { successEnvelope, errorEnvelope } from '../utils/envelope.js';

export class SessionController {
  static async listSessions(user, options = {}) {
    if (!user) {
      return errorEnvelope('Unauthorized', null, 401);
    }
    const isAdmin = user.role === 'admin';
    const sessions = await SessionService.getSessionsByAsn(user.asn, isAdmin);
    if (options.lite) {
      const liteSessions = sessions.map(s => {
        const { notification, assigned, runtime, ...rest } = s;
        let liteAssigned = assigned;
        if (assigned && typeof assigned === 'object') {
          const { serverWireguardSnippet, ...restAssigned } = assigned;
          liteAssigned = restAssigned;
        }
        let liteRuntime = runtime;
        if (runtime && typeof runtime === 'object') {
          const { trafficSeries, ...restRuntime } = runtime;
          liteRuntime = restRuntime;
        }
        return {
          ...rest,
          assigned: liteAssigned,
          runtime: liteRuntime
        };
      });
      return successEnvelope(liteSessions, 200);
    }
    return successEnvelope(sessions, 200);
  }

  static async deleteSession(sessionId, user) {
    if (!user) {
      return errorEnvelope('Unauthorized', null, 401);
    }
    const isAdmin = user.role === 'admin';
    const result = await SessionService.deleteSession(sessionId, user.asn, isAdmin, {
      requesterMnt: user.mnt || user.maintainer || user.asName
    });
    if (!result.success) {
      return errorEnvelope(result.message, null, 200);
    }
    return successEnvelope({ message: result.message }, 200);
  }
}
