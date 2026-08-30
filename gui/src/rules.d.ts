declare module '@shared/generated/rules.js' {
  export const RULES: any;
  export const ASN_REGEX: RegExp;
  export const PUBLIC_KEY_REGEX: RegExp;
  export const IPV4_REGEX: RegExp;
  export const ENDPOINT_REGEX: RegExp;
  export const IPV6_ULA_REGEX: RegExp;
  export const LINK_LOCAL_REGEX: RegExp;

  export function normalizeAsn(val: any): string;
  export function calcDefaultPort(asn: any): number;
  export function formatDefaultLinkLocal(asn: any): string;
  export function validateAsn(val: any): { valid: boolean; value?: number; error?: string };
  export function validatePublicKey(val: any): { valid: boolean; value?: string; error?: string };
  export function validateIpv4(val: any, isOptional?: boolean): { valid: boolean; value?: string | null; error?: string };
  export function validateEndpoint(val: any, isOptional?: boolean): { valid: boolean; value?: string; error?: string };
  export function validateIpv6Ula(val: any, isOptional?: boolean): { valid: boolean; value?: string | null; error?: string };
  export function validateLinkLocal(val: any): { valid: boolean; value?: string; error?: string };
  export function validatePort(val: any, isOptional?: boolean): { valid: boolean; value?: number | string; error?: string };
  export function validateMtu(val: any): { valid: boolean; value?: number; error?: string };
}
