/**
 * WildGuard - Deterministic Guardrails Module
 * Enforces zero-trust local security policies on filesystem reads, writes,
 * patches, branch operations, and dependency modifications.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

export type PolicyStatus = 'allowed' | 'blocked' | 'requires_approval';

export interface PolicyResult {
  status: PolicyStatus;
  reasonCode: string;
  message: string;
  details?: Record<string, unknown>;
}

export const BLOCKED_BRANCHES = new Set(['main', 'master']);

export const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'pyproject.toml',
  'poetry.lock',
  'Cargo.toml',
  'Cargo.lock',
  'build.gradle',
  'pom.xml',
  'go.mod',
  'go.sum',
]);

const SENSITIVE_FILENAME_PATTERNS = [
  /^\.env(\..+)?$/i,
  /^id_rsa(\..+)?$/i,
  /^id_dsa(\..+)?$/i,
  /^id_ecdsa(\..+)?$/i,
  /^id_ed25519(\..+)?$/i,
  /\.(pem|key|pkcs12|pfx|kdbx|keystore)$/i,
  /(credentials|secrets|passwords|auth_token)\.(json|yaml|yml|xml|txt)$/i,
];

const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN\s+([A-Z\s]+)?PRIVATE\s+KEY-----/,
  /(api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|bearer)\s*[:=]\s*["']?[a-zA-Z0-9_\-\.]{16,}["']?/i,
  /ghp_[a-zA-Z0-9]{36}/,
  /github_pat_[a-zA-Z0-9_]{82}/,
  /sk-[a-zA-Z0-9]{48}/,
];

const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Normalizes Windows drive letter to uppercase (e.g. c:\ -> C:\) to prevent case-mismatch
 * in path.relative containment checks across different Node/OS calls.
 */
export function normalizeDriveLetter(p: string): string {
  if (process.platform === 'win32' && /^[a-zA-Z]:/.test(p)) {
    return p[0].toUpperCase() + p.slice(1);
  }
  return p;
}

/**
 * Strips Windows trailing dots and spaces from a path segment for security comparison,
 * without altering the legitimate base name.
 */
export function cleanWindowsSegment(segment: string): string {
  if (segment === '.' || segment === '..') {
    return segment;
  }
  return segment.replace(/[\s.]+$/, '');
}

/**
 * Validates whether a path contains Windows reserved DOS device names or control characters.
 */
function checkWindowsDeviceNames(normalizedPath: string): boolean {
  const segments = normalizedPath.split('/');
  for (const seg of segments) {
    if (!seg) continue;
    const clean = cleanWindowsSegment(seg).toLowerCase();
    // Check exact name (e.g. CON or NUL) or name before extension (e.g. CON.txt)
    const baseName = clean.split('.')[0];
    if (WINDOWS_RESERVED_DEVICE_NAMES.has(baseName)) {
      return true;
    }
  }
  return false;
}

/**
 * Validates whether a file path is safely contained within the repository root.
 * Blocks directory traversal, absolute path escape, symlink escape, drive prefix escapes, UNC paths.
 */
export function validatePathContainment(repoRoot: string, targetPath: string): PolicyResult {
  try {
    if (targetPath === null || targetPath === undefined || typeof targetPath !== 'string') {
      return {
        status: 'blocked',
        reasonCode: 'INVALID_PATH',
        message: 'File path must be a string.',
      };
    }

    // Check for null bytes or unprintable control characters
    if (/[\x00-\x1f]/.test(targetPath)) {
      return {
        status: 'blocked',
        reasonCode: 'MALFORMED_PATH',
        message: 'File path contains invalid control characters or null bytes.',
      };
    }

    // Allow empty string or '.' as pointing to the repository root itself
    const sanitized = targetPath.trim();
    if (sanitized === '' || sanitized === '.') {
      const resolvedRoot = path.resolve(repoRoot);
      const realRoot = fs.existsSync(resolvedRoot) ? fs.realpathSync(resolvedRoot) : resolvedRoot;
      return {
        status: 'allowed',
        reasonCode: 'PATH_CONTAINMENT_VERIFIED',
        message: 'Path is within repository root.',
        details: { resolvedTarget: realRoot, relativeTarget: '' },
      };
    }

    // Reject raw traversal patterns and UNC escapes before resolution
    const normalizedInput = sanitized.replace(/\\/g, '/');
    if (normalizedInput.includes('../') || normalizedInput.includes('/..') || normalizedInput === '..') {
      return {
        status: 'blocked',
        reasonCode: 'PATH_TRAVERSAL_DETECTED',
        message: 'Path traversal sequences (..) are strictly forbidden.',
      };
    }

    if (normalizedInput.startsWith('//') || normalizedInput.startsWith('\\\\')) {
      return {
        status: 'blocked',
        reasonCode: 'UNC_PATH_FORBIDDEN',
        message: 'UNC paths are not permitted.',
      };
    }

    // Reject NTFS alternate data streams (e.g. file.txt:stream or file.txt::$DATA)
    // On Windows, a drive letter at the beginning like C: is permissible, but any other colon is an ADS
    const withoutDrive = targetPath.replace(/^[a-zA-Z]:/, '');
    if (withoutDrive.includes(':')) {
      return {
        status: 'blocked',
        reasonCode: 'NTFS_STREAM_FORBIDDEN',
        message: 'NTFS alternate data streams (:) are strictly forbidden.',
      };
    }

    // Reject reserved Windows device names (CON, NUL, AUX, COM1-9, LPT1-9)
    if (checkWindowsDeviceNames(normalizedInput)) {
      return {
        status: 'blocked',
        reasonCode: 'RESERVED_DEVICE_NAME',
        message: 'Paths referencing Windows reserved device names (CON, PRN, AUX, NUL, COM, LPT) are forbidden.',
      };
    }

    // Resolve canonical repository root
    const resolvedRoot = normalizeDriveLetter(path.resolve(repoRoot));
    const realRoot = normalizeDriveLetter(fs.existsSync(resolvedRoot) ? fs.realpathSync(resolvedRoot) : resolvedRoot);

    // Resolve target path relative to repository root
    const rawResolvedTarget = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(resolvedRoot, targetPath);
    const resolvedTarget = normalizeDriveLetter(rawResolvedTarget);

    // Calculate relative path from root to target
    const relative = path.relative(resolvedRoot, resolvedTarget);

    // Check if target escapes root via path resolution
    const isEscaping = relative.startsWith('..') || path.isAbsolute(relative);
    if (isEscaping) {
      return {
        status: 'blocked',
        reasonCode: 'REPOSITORY_BOUNDARY_ESCAPE',
        message: 'Operation target is outside the designated repository root boundary.',
        details: { relativeTarget: relative },
      };
    }

    // If file exists, check for symlink escapes
    if (fs.existsSync(resolvedTarget)) {
      try {
        const realTargetPath = normalizeDriveLetter(fs.realpathSync(resolvedTarget));
        const realRelative = path.relative(realRoot, realTargetPath);
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
          return {
            status: 'blocked',
            reasonCode: 'SYMLINK_BOUNDARY_ESCAPE',
            message: 'Target resolves via symlink to a location outside the repository root.',
          };
        }
      } catch {
        // If realpathSync fails, fail closed
        return {
          status: 'blocked',
          reasonCode: 'CANONICALIZATION_FAILURE',
          message: 'Unable to safely verify canonical target path.',
        };
      }
    } else {
      // For nonexistent targets: walk upward to nearest existing parent directory
      try {
        let checkDir = path.dirname(resolvedTarget);
        const uncreatedParts: string[] = [path.basename(resolvedTarget)];
        while (checkDir && !fs.existsSync(checkDir) && checkDir !== path.dirname(checkDir)) {
          uncreatedParts.unshift(path.basename(checkDir));
          checkDir = path.dirname(checkDir);
        }
        if (!fs.existsSync(checkDir)) {
          return {
            status: 'blocked',
            reasonCode: 'CANONICALIZATION_FAILURE',
            message: 'Unable to verify parent directory for nonexistent target path.',
          };
        }
        const realParent = normalizeDriveLetter(fs.realpathSync(checkDir));
        const parentRel = path.relative(realRoot, realParent);
        if (parentRel.startsWith('..') || path.isAbsolute(parentRel)) {
          return {
            status: 'blocked',
            reasonCode: 'SYMLINK_BOUNDARY_ESCAPE',
            message: 'Target directory resolves via symlink outside repository root.',
          };
        }
        // Ensure uncreated parts don't escape
        const reconstructed = normalizeDriveLetter(path.resolve(realParent, ...uncreatedParts));
        const finalRel = path.relative(realRoot, reconstructed);
        if (finalRel.startsWith('..') || path.isAbsolute(finalRel)) {
          return {
            status: 'blocked',
            reasonCode: 'REPOSITORY_BOUNDARY_ESCAPE',
            message: 'Reconstructed target resolves outside designated repository root.',
          };
        }
      } catch {
        return {
          status: 'blocked',
          reasonCode: 'CANONICALIZATION_FAILURE',
          message: 'Unable to safely verify canonical directory path.',
        };
      }
    }

    return {
      status: 'allowed',
      reasonCode: 'PATH_CONTAINMENT_VERIFIED',
      message: 'Path is within repository root.',
      details: { resolvedTarget, relativeTarget: relative },
    };
  } catch (err) {
    return {
      status: 'blocked',
      reasonCode: 'PATH_VALIDATION_ERROR',
      message: `Path containment validation error: ${(err as Error).message}`,
    };
  }
}

/**
 * Validates whether a file is permitted to be read based on secret and sensitive name patterns.
 */
export function validateFileReadPolicy(repoRoot: string, filePath: string): PolicyResult {
  // First verify containment
  const containment = validatePathContainment(repoRoot, filePath);
  if (containment.status !== 'allowed') {
    return containment;
  }

  const resolvedTarget = containment.details?.resolvedTarget as string || path.resolve(repoRoot, filePath);
  
  // Inspect all path segments to ensure no intermediate segment is a secret directory or secret file
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  
  for (const seg of segments) {
    const cleanSeg = cleanWindowsSegment(seg);
    for (const pattern of SENSITIVE_FILENAME_PATTERNS) {
      if (pattern.test(cleanSeg)) {
        return {
          status: 'blocked',
          reasonCode: 'SECRET_FILE_READ_BLOCKED',
          message: `Access to sensitive credential or environment segment "${cleanSeg}" is strictly forbidden.`,
        };
      }
    }
  }

  const rawBasename = path.basename(resolvedTarget);
  // Strip Windows trailing dots/spaces to prevent bypasses (.env. or .env )
  const basename = cleanWindowsSegment(rawBasename);

  // Check filename against sensitive patterns
  for (const pattern of SENSITIVE_FILENAME_PATTERNS) {
    if (pattern.test(basename)) {
      return {
        status: 'blocked',
        reasonCode: 'SECRET_FILE_READ_BLOCKED',
        message: `Access to sensitive credential or environment file "${basename}" is strictly forbidden.`,
      };
    }
  }

  // If file exists, check content for sensitive signatures
  if (fs.existsSync(resolvedTarget)) {
    try {
      const stat = fs.statSync(resolvedTarget);
      // Bound check for scanning (up to 512KB)
      if (stat.isFile() && stat.size <= 512 * 1024) {
        const content = fs.readFileSync(resolvedTarget, 'utf-8');
        for (const pattern of SECRET_CONTENT_PATTERNS) {
          if (pattern.test(content)) {
            return {
              status: 'blocked',
              reasonCode: 'SECRET_CONTENT_DETECTED',
              message: `File "${basename}" contains high-entropy credential or private key material and cannot be read.`,
            };
          }
        }
      }
    } catch (err) {
      // If reading fails for unexpected reasons, fail closed
      return {
        status: 'blocked',
        reasonCode: 'FILE_INSPECTION_FAILED',
        message: `Failed to safely verify file content: ${(err as Error).message}`,
      };
    }
  }

  return {
    status: 'allowed',
    reasonCode: 'FILE_READ_PERMITTED',
    message: 'File read permitted.',
  };
}

/**
 * Validates a proposed write or patch operation against Git branch and dependency policies.
 */
export function validateWritePolicy(
  repoRoot: string,
  filePath: string,
  currentBranch: string
): PolicyResult {
  // Verify branch protection
  const branchNormalized = currentBranch.trim().toLowerCase();
  if (BLOCKED_BRANCHES.has(branchNormalized) || branchNormalized.endsWith('/main') || branchNormalized.endsWith('/master')) {
    return {
      status: 'blocked',
      reasonCode: 'PROTECTED_BRANCH_WRITE_BLOCKED',
      message: `Direct writes, patches, and commits against protected branch "${currentBranch}" are strictly prohibited.`,
      details: { branch: currentBranch },
    };
  }

  // Verify path containment
  const containment = validatePathContainment(repoRoot, filePath);
  if (containment.status !== 'allowed') {
    return containment;
  }

  const resolvedTarget = containment.details?.resolvedTarget as string || path.resolve(repoRoot, filePath);
  const rawBasename = path.basename(resolvedTarget);
  const basename = cleanWindowsSegment(rawBasename);

  // Check if target or any segment is a secret file (never allow overwriting secrets via agent)
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    const cleanSeg = cleanWindowsSegment(seg);
    for (const pattern of SENSITIVE_FILENAME_PATTERNS) {
      if (pattern.test(cleanSeg)) {
        return {
          status: 'blocked',
          reasonCode: 'SECRET_FILE_OVERWRITE_BLOCKED',
          message: `Overwriting credential or secret file "${cleanSeg}" is strictly blocked.`,
        };
      }
    }
  }

  for (const pattern of SENSITIVE_FILENAME_PATTERNS) {
    if (pattern.test(basename)) {
      return {
        status: 'blocked',
        reasonCode: 'SECRET_FILE_OVERWRITE_BLOCKED',
        message: `Overwriting credential or secret file "${basename}" is strictly blocked.`,
      };
    }
  }

  // Check dependency protection policy (case-insensitive for cross-platform defense)
  if (DEPENDENCY_FILES.has(basename) || DEPENDENCY_FILES.has(basename.toLowerCase())) {
    return {
      status: 'requires_approval',
      reasonCode: 'DEPENDENCY_MODIFICATION_REQUIRES_APPROVAL',
      message: `Proposed modifications to dependency configuration file "${basename}" require explicit human approval.`,
      details: { file: basename, branch: currentBranch },
    };
  }

  return {
    status: 'allowed',
    reasonCode: 'WRITE_POLICY_PERMITTED',
    message: 'File modification permitted under current branch and path policy.',
  };
}

/**
 * Validates branch creation requests.
 */
export function validateBranchCreation(branchName: string): PolicyResult {
  if (!branchName || typeof branchName !== 'string') {
    return {
      status: 'blocked',
      reasonCode: 'INVALID_BRANCH_NAME',
      message: 'Branch name must be a non-empty string.',
    };
  }

  const normalized = branchName.trim();
  if (BLOCKED_BRANCHES.has(normalized.toLowerCase()) || normalized.toLowerCase().endsWith('/main') || normalized.toLowerCase().endsWith('/master')) {
    return {
      status: 'blocked',
      reasonCode: 'PROTECTED_BRANCH_CREATION_BLOCKED',
      message: `Cannot create or reset protected branch "${normalized}".`,
    };
  }

  // Valid git branch name checks: no control characters, spaces, ~ ^ : ? * [
  const invalidGitChars = /[\s~^:?*\[\\@{]/;
  if (invalidGitChars.test(normalized) || normalized.startsWith('/') || normalized.endsWith('/') || normalized.includes('..')) {
    return {
      status: 'blocked',
      reasonCode: 'MALFORMED_BRANCH_NAME',
      message: `Branch name "${normalized}" contains invalid Git reference characters.`,
    };
  }

  return {
    status: 'allowed',
    reasonCode: 'BRANCH_CREATION_PERMITTED',
    message: 'Branch name is valid.',
    details: { branch: normalized },
  };
}
