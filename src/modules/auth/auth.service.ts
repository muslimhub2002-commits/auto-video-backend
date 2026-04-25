import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../users/entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleExchangeDto } from './dto/google-exchange.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { sanitizeAuthUser } from './utils/sanitize-auth-user';

@Injectable()
export class AuthService {
  private readonly googleAuthClient = new OAuth2Client();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  private sanitizeUser(user: User) {
    return sanitizeAuthUser(user);
  }

  private buildAuthResponse(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: this.sanitizeUser(user),
    };
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private getGoogleClientId() {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();

    if (!clientId) {
      throw new InternalServerErrorException('Google sign-in is not configured.');
    }

    return clientId;
  }

  private async verifyGoogleIdentity(idToken: string) {
    const ticket = await this.googleAuthClient.verifyIdToken({
      idToken,
      audience: this.getGoogleClientId(),
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || !payload.email_verified) {
      throw new UnauthorizedException('Google account email must be verified.');
    }

    return {
      subject: payload.sub,
      email: this.normalizeEmail(payload.email),
    };
  }

  async register(
    registerDto: RegisterDto,
  ): Promise<{ access_token: string; user: Partial<User> }> {
    const normalizedEmail = this.normalizeEmail(registerDto.email);
    const { password } = registerDto;

    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const user = this.userRepository.create({
      email: normalizedEmail,
      password: hashedPassword,
      roles: ['user'], // Default role
    });

    await this.userRepository.save(user);

    return this.buildAuthResponse(user);
  }

  async login(
    loginDto: LoginDto,
  ): Promise<{ access_token: string; user: Partial<User> }> {
    const normalizedEmail = this.normalizeEmail(loginDto.email);
    const { password } = loginDto;

    // Find user
    const user = await this.userRepository.findOne({ where: { email: normalizedEmail } });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password) {
      throw new UnauthorizedException(
        'This account uses Google sign-in. Continue with Google instead.',
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user);
  }

  async exchangeGoogleToken(
    googleExchangeDto: GoogleExchangeDto,
  ): Promise<{ access_token: string; user: Partial<User> }> {
    const identity = await this.verifyGoogleIdentity(googleExchangeDto.idToken);

    const existingGoogleUser = await this.userRepository.findOne({
      where: { google_subject: identity.subject },
    });

    if (existingGoogleUser) {
      existingGoogleUser.google_connected_at = new Date();
      await this.userRepository.save(existingGoogleUser);
      return this.buildAuthResponse(existingGoogleUser);
    }

    const existingEmailUser = await this.userRepository.findOne({
      where: { email: identity.email },
    });

    if (existingEmailUser) {
      if (
        existingEmailUser.google_subject &&
        existingEmailUser.google_subject !== identity.subject
      ) {
        throw new ConflictException('Google account is already linked to another user.');
      }

      existingEmailUser.google_subject = identity.subject;
      existingEmailUser.google_connected_at = new Date();
      await this.userRepository.save(existingEmailUser);
      return this.buildAuthResponse(existingEmailUser);
    }

    const user = this.userRepository.create({
      email: identity.email,
      password: null,
      roles: ['user'],
      google_subject: identity.subject,
      google_connected_at: new Date(),
    });

    await this.userRepository.save(user);

    return this.buildAuthResponse(user);
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { email: this.normalizeEmail(email) },
    });

    if (user?.password && (await bcrypt.compare(password, user.password))) {
      return user;
    }

    return null;
  }

  async getUserById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}
