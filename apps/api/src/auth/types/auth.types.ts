import type { UserRecord } from '../../users/types/user.types.js';
import type { CreatedSession } from './session.types.js';

export interface AuthResult {
    user: UserRecord;
    session: CreatedSession;
}
