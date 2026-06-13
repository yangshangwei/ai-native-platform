import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	pathToFileUri,
	fileUriToPath,
	getConfigDir,
	normalizePathForComparison,
	killProcessTree,
} from '../src/utils/platform';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';

describe('pathToFileUri', () => {
	it('should convert Windows absolute path to file URI', () => {
		const input = 'C:\\Users\\test\\file.txt';
		const result = pathToFileUri(input);
		expect(result).toMatch(/^file:\/\/\//);
		expect(result).toContain('/Users/test/file.txt');
	});

	it('should convert Unix absolute path to file URI', () => {
		const input = '/home/user/file.txt';
		const result = pathToFileUri(input);
		expect(result).toBe('file:///home/user/file.txt');
	});

	it('should handle paths with special characters', () => {
		const input = process.platform === 'win32'
			? 'C:\\Users\\test\\file with spaces.txt'
			: '/home/user/file with spaces.txt';
		const result = pathToFileUri(input);
		expect(result).toMatch(/^file:\/\/\//);
		expect(result).toContain('file%20with%20spaces.txt');
	});
});

describe('fileUriToPath', () => {
	it('should convert Windows file URI to path', () => {
		const input = 'file:///C:/Users/test/file.txt';
		const result = fileUriToPath(input);
		if (process.platform === 'win32') {
			expect(result).toBe('C:\\Users\\test\\file.txt');
		} else {
			// On Unix, it will return a path but won't have the drive letter format
			expect(result).toBeTruthy();
		}
	});

	it('should convert Unix file URI to path', () => {
		const input = 'file:///home/user/file.txt';
		const result = fileUriToPath(input);
		expect(result).toContain('/home/user/file.txt');
	});

	it('should handle URL-encoded characters', () => {
		const input = 'file:///home/user/file%20with%20spaces.txt';
		const result = fileUriToPath(input);
		expect(result).toContain('file with spaces.txt');
	});

	it('should throw on invalid URI', () => {
		expect(() => fileUriToPath('not-a-file-uri')).toThrow('Invalid file URI');
		expect(() => fileUriToPath('http://example.com')).toThrow('Invalid file URI');
	});
});

describe('getConfigDir', () => {
	it('should return Windows APPDATA path on Windows', () => {
		const result = getConfigDir();

		if (process.platform === 'win32') {
			expect(result).toContain('AppData');
			expect(result).toContain('ai-native');
		} else {
			expect(result).toBe(path.join(homedir(), '.ai-native'));
		}
	});

	it('should return Unix hidden directory on Unix', () => {
		const result = getConfigDir();

		if (process.platform !== 'win32') {
			expect(result).toBe(path.join(homedir(), '.ai-native'));
		}
	});

	it('should return an absolute path', () => {
		const result = getConfigDir();
		expect(path.isAbsolute(result)).toBe(true);
	});
});

describe('normalizePathForComparison', () => {
	it('should convert backslashes to forward slashes', () => {
		const input = 'C:\\Users\\test\\file.txt';
		const result = normalizePathForComparison(input);
		expect(result).toBe('C:/Users/test/file.txt');
	});

	it('should remove trailing slash from non-root paths', () => {
		expect(normalizePathForComparison('/home/user/')).toBe('/home/user');
		expect(normalizePathForComparison('C:/Users/test/')).toBe('C:/Users/test');
	});

	it('should preserve trailing slash for root directories', () => {
		expect(normalizePathForComparison('/')).toBe('/');
		expect(normalizePathForComparison('C:/')).toBe('C:/');
		expect(normalizePathForComparison('D:\\')).toBe('D:/');
	});

	it('should handle mixed separators', () => {
		const input = 'C:\\Users/test\\file/path';
		const result = normalizePathForComparison(input);
		expect(result).toBe('C:/Users/test/file/path');
	});

	it('should preserve case', () => {
		const input = 'C:\\Users\\TEST\\File.txt';
		const result = normalizePathForComparison(input);
		expect(result).toBe('C:/Users/TEST/File.txt');
	});
});

describe('killProcessTree', () => {
	let childProcess: ReturnType<typeof spawn> | null = null;

	afterEach(async () => {
		if (childProcess && childProcess.exitCode === null && childProcess.signalCode === null) {
			try {
				childProcess.kill('SIGKILL');
			} catch {
				// Process might already be dead
			}
		}
		childProcess = null;
	});

	it('should kill a process and its children', async () => {
		// Spawn a long-running process WITHOUT detached so we get exit events
		childProcess = spawn(process.platform === 'win32' ? 'timeout' : 'sleep',
			process.platform === 'win32' ? ['10'] : ['10']
		);

		const pid = childProcess.pid;
		expect(pid).toBeDefined();

		// Track if exit event fires
		let exitFired = false;
		let exitSignal: string | null = null;
		childProcess.on('exit', (code, signal) => {
			exitFired = true;
			exitSignal = signal;
		});

		// Give it a moment to start
		await new Promise(resolve => setTimeout(resolve, 100));

		// Kill it
		await killProcessTree(pid!);

		// Wait for exit event
		await new Promise(resolve => setTimeout(resolve, 500));

		// Verify the exit event fired (process was terminated)
		expect(exitFired).toBe(true);
		if (process.platform !== 'win32') {
			// On Unix, we should see a signal
			expect(exitSignal).toBeTruthy();
		}

		childProcess = null;
	}, 10000);

	it('should handle non-existent process gracefully', async () => {
		// Use a PID that's very unlikely to exist
		const fakePid = 99999999;

		if (process.platform === 'win32') {
			// Windows taskkill returns exit code 128 for process not found, which we handle
			await expect(killProcessTree(fakePid)).resolves.toBeUndefined();
		} else {
			// Unix will throw ESRCH error
			await expect(killProcessTree(fakePid)).rejects.toThrow();
		}
	});

	it('should accept custom signal on Unix', async () => {
		if (process.platform === 'win32') {
			// Skip on Windows as signals don't apply
			return;
		}

		childProcess = spawn('sleep', ['10']);
		const pid = childProcess.pid;
		expect(pid).toBeDefined();

		let exitFired = false;
		let exitSignal: string | null = null;
		childProcess.on('exit', (code, signal) => {
			exitFired = true;
			exitSignal = signal;
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		// Use SIGKILL
		await killProcessTree(pid!, 'SIGKILL');

		// Wait for exit event
		await new Promise(resolve => setTimeout(resolve, 500));

		// Verify the exit event fired with SIGKILL
		expect(exitFired).toBe(true);
		expect(exitSignal).toBe('SIGKILL');

		childProcess = null;
	}, 10000);
});
