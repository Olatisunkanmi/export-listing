import { Request } from 'express';

export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  type: TokenType;
  agentId: string;
  email: string;
  sessionId: string;
}

export interface RequestWithUser extends Request {
  user: JwtPayload;
}
