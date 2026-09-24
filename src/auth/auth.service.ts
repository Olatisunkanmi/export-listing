import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import ms from 'ms';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

interface AgentRecord {
  id: string;
  email: string;
  name: string | null;
}

const DEFAULT_ACCESS_EXPIRES_IN = '15m';
const DEFAULT_REFRESH_EXPIRES_IN = '7d';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.agent.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An agent with this email already exists');
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    const agent = await this.prisma.agent.create({
      data: { email: dto.email, password: hashedPassword, name: dto.name },
    });

    return this.startSession(agent);
  }

  async login(dto: LoginDto) {
    const agent = await this.prisma.agent.findUnique({
      where: { email: dto.email },
    });
    if (!agent) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, agent.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.startSession(agent);
  }

  async refresh(dto: RefreshTokenDto): Promise<{ accessToken: string }> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Not a refresh token');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
    });
    if (
      !session ||
      session.agentId !== payload.agentId ||
      session.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Session has been revoked or expired');
    }

    const accessToken = this.signAccessToken(
      { id: payload.agentId, email: payload.email },
      session.id,
    );
    return { accessToken };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async logoutAll(agentId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { agentId } });
  }

  private async startSession(agent: AgentRecord) {
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
      DEFAULT_REFRESH_EXPIRES_IN;

    const session = await this.prisma.session.create({
      data: {
        agentId: agent.id,
        expiresAt: new Date(
          Date.now() + ms(refreshExpiresIn as ms.StringValue),
        ),
      },
    });

    return {
      accessToken: this.signAccessToken(agent, session.id),
      refreshToken: this.signRefreshToken(agent, session.id, refreshExpiresIn),
      agent: { id: agent.id, email: agent.email, name: agent.name },
    };
  }

  private signAccessToken(
    agent: { id: string; email: string },
    sessionId: string,
  ): string {
    const payload: JwtPayload = {
      type: 'access',
      agentId: agent.id,
      email: agent.email,
      sessionId,
    };
    const expiresIn =
      this.configService.get<string>('JWT_EXPIRES_IN') ||
      DEFAULT_ACCESS_EXPIRES_IN;
    return this.jwtService.sign(payload, {
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });
  }

  private signRefreshToken(
    agent: { id: string; email: string },
    sessionId: string,
    expiresIn: string,
  ): string {
    const payload: JwtPayload = {
      type: 'refresh',
      agentId: agent.id,
      email: agent.email,
      sessionId,
    };
    return this.jwtService.sign(payload, {
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });
  }
}
