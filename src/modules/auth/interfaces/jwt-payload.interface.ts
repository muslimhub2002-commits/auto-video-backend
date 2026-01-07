export interface JwtPayload {
  sub: string; // user id
  email: string;
  roles?: string[];
}
