/**
 * Lua script loader service.
 * Loads inline Lua scripts and registers them with Redis.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files).
 */

import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { CACHE_REDIS_DRIVER } from '../../../shared/constants';

import { ADD_KEY_TO_TAGS_SCRIPT, INVALIDATE_TAG_SCRIPT } from '../scripts/lua-scripts';

/**
 * Map of script names to their inline content.
 */
const SCRIPTS: Record<string, string> = {
  'invalidate-tag': INVALIDATE_TAG_SCRIPT,
  'add-key-to-tags': ADD_KEY_TO_TAGS_SCRIPT,
};

@Injectable()
export class LuaScriptLoader implements OnModuleInit {
  private readonly logger = new Logger(LuaScriptLoader.name);
  private readonly scriptShas = new Map<string, string>();

  constructor(@Inject(CACHE_REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  async onModuleInit(): Promise<void> {
    await this.loadScripts();
  }

  /**
   * Loads all Lua scripts into Redis.
   */
  private async loadScripts(): Promise<void> {
    for (const [scriptName, scriptContent] of Object.entries(SCRIPTS)) {
      try {
        // Load script into Redis and get SHA
        const sha = await this.driver.scriptLoad(scriptContent);
        this.scriptShas.set(scriptName, sha);

        this.logger.debug(`Loaded Lua script: ${scriptName} (SHA: ${sha})`);
      } catch (error) {
        this.logger.error(`Failed to load script ${scriptName}:`, error);
        throw error;
      }
    }

    this.logger.log(`Successfully loaded ${this.scriptShas.size} Lua scripts`);
  }

  /**
   * Executes a Lua script by name using EVALSHA.
   *
   * @param scriptName - Name of the script
   * @param keys - Redis keys to pass to the script
   * @param args - Arguments to pass to the script
   * @returns Script execution result
   */
  async evalSha(scriptName: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    const sha = this.scriptShas.get(scriptName);

    if (!sha) {
      throw new Error(`Lua script not loaded: ${scriptName}`);
    }

    return this.driver.evalsha(sha, keys, args);
  }

  /**
   * Gets the SHA hash of a loaded script.
   *
   * @param scriptName - Name of the script
   * @returns SHA hash or undefined if not loaded
   */
  getSha(scriptName: string): string | undefined {
    return this.scriptShas.get(scriptName);
  }

  /**
   * Checks if a script is loaded.
   *
   * @param scriptName - Name of the script
   * @returns True if script is loaded
   */
  isLoaded(scriptName: string): boolean {
    return this.scriptShas.has(scriptName);
  }
}
