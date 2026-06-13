/**
 * Cross-platform utilities for Windows compatibility.
 *
 * Addresses Windows compatibility issues found in the audit:
 * - File URI construction and parsing
 * - Process tree termination
 * - Platform-specific configuration directories
 * - Path normalization for comparison
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * Convert an absolute file path to a file:// URI.
 *
 * @param absolutePath - Absolute file system path
 * @returns Properly formatted file:// URI with URL encoding
 *
 * @example
 * // Windows
 * pathToFileUri('C:\\Users\\file.txt') // => 'file:///C:/Users/file.txt'
 * // Unix
 * pathToFileUri('/home/user/file.txt') // => 'file:///home/user/file.txt'
 */
export function pathToFileUri(absolutePath: string): string {
	return pathToFileURL(absolutePath).href;
}

/**
 * Convert a file:// URI to a file system path.
 *
 * @param uri - File URI (must start with file://)
 * @returns Platform-specific file system path
 *
 * @example
 * // Windows
 * fileUriToPath('file:///C:/Users/file.txt') // => 'C:\\Users\\file.txt'
 * // Unix
 * fileUriToPath('file:///home/user/file.txt') // => '/home/user/file.txt'
 */
export function fileUriToPath(uri: string): string {
	if (!uri.startsWith('file://')) {
		throw new Error(`Invalid file URI: ${uri} (must start with file://)`);
	}
	return fileURLToPath(uri);
}

/**
 * Kill a process and all its child processes.
 *
 * @param pid - Process ID to kill
 * @param signal - Signal to send (Unix only, default: 'SIGTERM')
 *
 * @example
 * await killProcessTree(12345);
 * await killProcessTree(12345, 'SIGKILL');
 */
export async function killProcessTree(
	pid: number,
	signal: string = 'SIGTERM'
): Promise<void> {
	if (process.platform === 'win32') {
		// Windows: use taskkill with /T (tree) and /F (force)
		return new Promise((resolve, reject) => {
			const proc = spawn('taskkill', ['/pid', pid.toString(), '/T', '/F'], {
				stdio: 'ignore',
			});

			proc.on('close', (code) => {
				// Exit code 0 = success
				// Exit code 128 = process not found (already dead)
				if (code === 0 || code === 128) {
					resolve();
				} else {
					reject(new Error(`taskkill failed with exit code ${code}`));
				}
			});

			proc.on('error', (err) => {
				reject(new Error(`Failed to spawn taskkill: ${err.message}`));
			});
		});
	} else {
		// Unix: use negative PID to kill process group
		try {
			process.kill(-pid, signal);
		} catch (err) {
			// Fallback: if process group kill fails, try killing main process only
			// This can happen if the process didn't create a new process group
			try {
				process.kill(pid, signal);
			} catch (fallbackErr) {
				throw new Error(
					`Failed to kill process ${pid}: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
				);
			}
		}
	}
}

/**
 * Get the platform-specific configuration directory.
 *
 * @returns Absolute path to configuration directory
 *
 * @example
 * // Windows
 * getConfigDir() // => 'C:\\Users\\username\\AppData\\Roaming\\ai-native'
 * // Unix
 * getConfigDir() // => '/home/username/.ai-native'
 */
export function getConfigDir(): string {
	if (process.platform === 'win32') {
		// Windows: use APPDATA environment variable
		const appData = process.env.APPDATA;
		if (appData) {
			return path.join(appData, 'ai-native');
		}
		// Fallback to home directory
		return path.join(homedir(), 'AppData', 'Roaming', 'ai-native');
	} else {
		// Unix: use hidden directory in home
		return path.join(homedir(), '.ai-native');
	}
}

/**
 * Normalize a path for comparison across platforms.
 *
 * Converts all path separators to forward slashes and removes trailing
 * separators (except for root directories). Does NOT change case.
 *
 * @param p - Path to normalize
 * @returns Normalized path with forward slashes
 *
 * @example
 * normalizePathForComparison('C:\\Users\\file\\') // => 'C:/Users/file'
 * normalizePathForComparison('/home/user/') // => '/home/user'
 * normalizePathForComparison('C:\\') // => 'C:/'
 */
export function normalizePathForComparison(p: string): string {
	// Convert all backslashes to forward slashes
	const normalized = p.replace(/\\/g, '/');

	// Remove trailing slash, but keep it for root directories
	// Root examples: 'C:/', '/', 'D:/'
	if (normalized.endsWith('/') && normalized.length > 1) {
		// Special case: don't strip if it's just a drive letter + slash (e.g., 'C:/')
		if (normalized.length === 3 && normalized[1] === ':') {
			return normalized;
		}
		return normalized.slice(0, -1);
	}

	return normalized;
}
