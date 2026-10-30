/**
 * WildGuard - Application-Owned Repository Tools
 * Sandboxed, auditable operations on local repositories with guardrail enforcement.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  validatePathContainment,
  validateFileReadPolicy,
  validateWritePolicy,
  validateBranchCreation,
  PolicyResult,
} from './guardrails.js';

export interface ToolResult<T = unknown> {
  success: boolean;
  toolName: string;
  data?: T;
  error?: string;
  reasonCode?: string;
  requiresApproval?: boolean;
  policyResult: PolicyResult;
}

export interface FileItem {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
}

export interface PatchResult {
  filePath: string;
  bytesWritten: number;
  linesModified: number;
  previewDiff: string;
}

export const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB limit for safe reads

export class McpRepoTools {
  private readonly repoRoot: string;
  private currentBranch: string;

  constructor(repoRoot: string, currentBranch = 'feat/otari-agent-harness') {
    this.repoRoot = path.resolve(repoRoot);
    this.currentBranch = currentBranch;
  }

  public getCurrentBranch(): string {
    return this.currentBranch;
  }

  public setCurrentBranch(branch: string): void {
    this.currentBranch = branch;
  }

  public getRepoRoot(): string {
    return this.repoRoot;
  }

  /**
   * Tool 1: List files within repository
   */
  public listFiles(subDirectory = '', recursive = false): ToolResult<FileItem[]> {
    const containment = validatePathContainment(this.repoRoot, subDirectory);
    if (containment.status !== 'allowed') {
      return {
        success: false,
        toolName: 'mcp_repo_list_files',
        error: containment.message,
        reasonCode: containment.reasonCode,
        policyResult: containment,
      };
    }

    const targetDir = containment.details?.resolvedTarget as string || path.resolve(this.repoRoot, subDirectory);

    if (!fs.existsSync(targetDir)) {
      return {
        success: false,
        toolName: 'mcp_repo_list_files',
        error: `Directory "${subDirectory}" does not exist.`,
        reasonCode: 'DIRECTORY_NOT_FOUND',
        policyResult: containment,
      };
    }

    try {
      const items: FileItem[] = [];
      const traverse = (dir: string, currentRel: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          // Ignore node_modules, .git, and common cache directories
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') {
            continue;
          }
          const relPath = path.join(currentRel, entry.name);
          const fullPath = path.join(dir, entry.name);

          // Check if file is secret/env
          const readCheck = validateFileReadPolicy(this.repoRoot, relPath);
          if (readCheck.status === 'blocked') {
            // Skip blocked secret files from listing or mark redacted
            continue;
          }

          let size = 0;
          try {
            const stat = fs.statSync(fullPath);
            size = stat.size;
          } catch {
            // Ignore stat errors
          }

          items.push({
            name: entry.name,
            relativePath: relPath.replace(/\\/g, '/'),
            isDirectory: entry.isDirectory(),
            sizeBytes: size,
          });

          if (recursive && entry.isDirectory()) {
            traverse(fullPath, relPath);
          }
        }
      };

      traverse(targetDir, subDirectory);

      return {
        success: true,
        toolName: 'mcp_repo_list_files',
        data: items,
        policyResult: containment,
      };
    } catch (err) {
      return {
        success: false,
        toolName: 'mcp_repo_list_files',
        error: `Failed to list files: ${(err as Error).message}`,
        reasonCode: 'READDIR_FAILED',
        policyResult: containment,
      };
    }
  }

  /**
   * Tool 2: Read file safely with content verification
   */
  public readFile(filePath: string): ToolResult<{ content: string; sizeBytes: number }> {
    const policy = validateFileReadPolicy(this.repoRoot, filePath);
    if (policy.status !== 'allowed') {
      return {
        success: false,
        toolName: 'mcp_repo_read_file',
        error: policy.message,
        reasonCode: policy.reasonCode,
        policyResult: policy,
      };
    }

    const resolved = path.resolve(this.repoRoot, filePath);
    if (!fs.existsSync(resolved)) {
      return {
        success: false,
        toolName: 'mcp_repo_read_file',
        error: `File not found: ${filePath}`,
        reasonCode: 'FILE_NOT_FOUND',
        policyResult: policy,
      };
    }

    try {
      const stat = fs.statSync(resolved);
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        return {
          success: false,
          toolName: 'mcp_repo_read_file',
          error: `File size (${stat.size} bytes) exceeds maximum allowable limit (${MAX_FILE_SIZE_BYTES} bytes).`,
          reasonCode: 'FILE_SIZE_EXCEEDED',
          policyResult: policy,
        };
      }

      const content = fs.readFileSync(resolved, 'utf-8');
      return {
        success: true,
        toolName: 'mcp_repo_read_file',
        data: {
          content,
          sizeBytes: stat.size,
        },
        policyResult: policy,
      };
    } catch (err) {
      return {
        success: false,
        toolName: 'mcp_repo_read_file',
        error: `Failed to read file: ${(err as Error).message}`,
        reasonCode: 'READ_FILE_ERROR',
        policyResult: policy,
      };
    }
  }

  /**
   * Tool 3: Apply patch safely with preview diff and human-approval checks
   */
  public applyPatch(
    filePath: string,
    newContent: string,
    isApproved = false
  ): ToolResult<PatchResult> {
    const policy = validateWritePolicy(this.repoRoot, filePath, this.currentBranch);

    if (policy.status === 'blocked') {
      return {
        success: false,
        toolName: 'mcp_repo_apply_patch',
        error: policy.message,
        reasonCode: policy.reasonCode,
        policyResult: policy,
      };
    }

    if (policy.status === 'requires_approval' && !isApproved) {
      // Generate a preview diff without writing
      const resolved = path.resolve(this.repoRoot, filePath);
      const oldContent = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf-8') : '';
      const preview = this.createSimpleDiff(oldContent, newContent, filePath);

      return {
        success: false,
        toolName: 'mcp_repo_apply_patch',
        error: policy.message,
        reasonCode: policy.reasonCode,
        requiresApproval: true,
        data: {
          filePath,
          bytesWritten: 0,
          linesModified: 0,
          previewDiff: preview,
        },
        policyResult: policy,
      };
    }

    // Re-verify policy immediately before writing (TOCTOU defense)
    const preWritePolicy = validateWritePolicy(this.repoRoot, filePath, this.currentBranch);
    if (preWritePolicy.status === 'blocked' || (preWritePolicy.status === 'requires_approval' && !isApproved)) {
      return {
        success: false,
        toolName: 'mcp_repo_apply_patch',
        error: preWritePolicy.message,
        reasonCode: preWritePolicy.reasonCode,
        policyResult: preWritePolicy,
      };
    }

    const resolved = path.resolve(this.repoRoot, filePath);
    try {
      const oldContent = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf-8') : '';
      const preview = this.createSimpleDiff(oldContent, newContent, filePath);

      // Ensure directory exists
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, newContent, 'utf-8');

      const lines = newContent.split('\n').length;
      return {
        success: true,
        toolName: 'mcp_repo_apply_patch',
        data: {
          filePath,
          bytesWritten: Buffer.byteLength(newContent, 'utf-8'),
          linesModified: lines,
          previewDiff: preview,
        },
        policyResult: policy,
      };
    } catch (err) {
      return {
        success: false,
        toolName: 'mcp_repo_apply_patch',
        error: `Failed to write patch: ${(err as Error).message}`,
        reasonCode: 'PATCH_WRITE_ERROR',
        policyResult: policy,
      };
    }
  }

  /**
   * Tool 4: Create branch safely
   */
  public createBranch(newBranchName: string): ToolResult<{ branch: string; previousBranch: string }> {
    const policy = validateBranchCreation(newBranchName);
    if (policy.status !== 'allowed') {
      return {
        success: false,
        toolName: 'mcp_repo_create_branch',
        error: policy.message,
        reasonCode: policy.reasonCode,
        policyResult: policy,
      };
    }

    const previousBranch = this.currentBranch;
    this.currentBranch = newBranchName.trim();

    return {
      success: true,
      toolName: 'mcp_repo_create_branch',
      data: {
        branch: this.currentBranch,
        previousBranch,
      },
      policyResult: policy,
    };
  }

  /**
   * Simple unified diff generator for previews
   */
  private createSimpleDiff(oldText: string, newText: string, filename: string): string {
    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText ? newText.split('\n') : [];
    return [
      `--- a/${filename}`,
      `+++ b/${filename}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines.map(l => `-${l}`),
      ...newLines.map(l => `+${l}`),
    ].join('\n');
  }
}
