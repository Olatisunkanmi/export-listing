import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

type MockPrisma = {
  agent: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  session: {
    create: jest.Mock;
    findUnique: jest.Mock;
    deleteMany: jest.Mock;
  };
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrisma;
  let jwtService: { sign: jest.Mock; verifyAsync: jest.Mock };

  const session = {
    id: 'session-1',
    agentId: 'agent-1',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };

  beforeEach(async () => {
    const mockPrisma: MockPrisma = {
      agent: { findUnique: jest.fn(), create: jest.fn() },
      session: {
        create: jest.fn().mockResolvedValue(session),
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    const mockJwtService = {
      sign: jest.fn().mockReturnValue('signed.jwt.token'),
      verifyAsync: jest.fn(),
    };
    const mockConfigService = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(AuthService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
  });

  describe('register', () => {
    it('throws ConflictException if the email is already registered', async () => {
      prisma.agent.findUnique.mockResolvedValue({ id: 'existing-agent' });

      await expect(
        service.register({ email: 'a@example.com', password: 'password123' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.agent.create).not.toHaveBeenCalled();
    });

    it('hashes the password, opens a session and signs access + refresh tokens', async () => {
      prisma.agent.findUnique.mockResolvedValue(null);
      prisma.agent.create.mockResolvedValue({
        id: 'agent-1',
        email: 'a@example.com',
        name: 'Ada',
        password: 'hashed',
      });

      const result = await service.register({
        email: 'a@example.com',
        password: 'password123',
        name: 'Ada',
      });

      const createCall = prisma.agent.create.mock.calls[0][0];
      expect(createCall.data.email).toBe('a@example.com');
      expect(createCall.data.password).not.toBe('password123');
      expect(
        await bcrypt.compare('password123', createCall.data.password),
      ).toBe(true);

      expect(prisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ agentId: 'agent-1' }),
      });

      const [accessCall, refreshCall] = jwtService.sign.mock.calls;
      expect(accessCall[0]).toMatchObject({
        type: 'access',
        agentId: 'agent-1',
        email: 'a@example.com',
        sessionId: 'session-1',
      });
      expect(refreshCall[0]).toMatchObject({
        type: 'refresh',
        agentId: 'agent-1',
        sessionId: 'session-1',
      });

      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        refreshToken: 'signed.jwt.token',
        agent: { id: 'agent-1', email: 'a@example.com', name: 'Ada' },
      });
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException if the email is not registered', async () => {
      prisma.agent.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'missing@example.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if the password does not match', async () => {
      const hashed = await bcrypt.hash(
        'correct-password',
        await bcrypt.genSalt(),
      );
      prisma.agent.findUnique.mockResolvedValue({
        id: 'agent-1',
        email: 'a@example.com',
        password: hashed,
        name: null,
      });

      await expect(
        service.login({ email: 'a@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('opens a session and returns access + refresh tokens when credentials are valid', async () => {
      const hashed = await bcrypt.hash(
        'correct-password',
        await bcrypt.genSalt(),
      );
      prisma.agent.findUnique.mockResolvedValue({
        id: 'agent-1',
        email: 'a@example.com',
        password: hashed,
        name: null,
      });

      const result = await service.login({
        email: 'a@example.com',
        password: 'correct-password',
      });

      expect(prisma.session.create).toHaveBeenCalled();
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
      expect(result.agent).toEqual({
        id: 'agent-1',
        email: 'a@example.com',
        name: null,
      });
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException if the token is not a refresh token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        type: 'access',
        agentId: 'agent-1',
        email: 'a@example.com',
        sessionId: 'session-1',
      });

      await expect(
        service.refresh({ refreshToken: 'some.access.token' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.session.findUnique).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException if the session was revoked', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        type: 'refresh',
        agentId: 'agent-1',
        email: 'a@example.com',
        sessionId: 'session-1',
      });
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(
        service.refresh({ refreshToken: 'revoked.refresh.token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if the session has expired', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        type: 'refresh',
        agentId: 'agent-1',
        email: 'a@example.com',
        sessionId: 'session-1',
      });
      prisma.session.findUnique.mockResolvedValue({
        ...session,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.refresh({ refreshToken: 'expired.refresh.token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues a new access token for a valid refresh token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        type: 'refresh',
        agentId: 'agent-1',
        email: 'a@example.com',
        sessionId: 'session-1',
      });
      prisma.session.findUnique.mockResolvedValue(session);

      const result = await service.refresh({
        refreshToken: 'valid.refresh.token',
      });

      expect(result).toEqual({ accessToken: 'signed.jwt.token' });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'access', sessionId: 'session-1' }),
        expect.anything(),
      );
    });
  });

  describe('logout', () => {
    it('deletes the session matching the given id', async () => {
      await service.logout('session-1');

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });
  });

  describe('logoutAll', () => {
    it('deletes every session belonging to the agent', async () => {
      await service.logoutAll('agent-1');

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { agentId: 'agent-1' },
      });
    });
  });
});
