/**
 * Utility functions for cache key generation from templates.
 */

import { CacheKeyError } from '../shared/errors';

/**
 * Extracts parameter names from method signature.
 *
 * @param method - Method to extract parameters from
 * @returns Array of parameter names
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getParameterNames(method: Function): string[] {
  const fnStr = method.toString().replace(/\/\*[\s\S]*?\*\//g, '');
  const match = fnStr.match(/\(([^)]*)\)/);

  if (!match?.[1]) {
    return [];
  }

  const params = match[1];
  return params
    .split(',')
    .map((param) => param.trim().split('=')[0]?.trim() ?? '')
    .filter((param) => param && param !== '');
}

/**
 * Gets nested property value from object.
 *
 * @param obj - Object to get value from
 * @param path - Property path (e.g., 'user.id')
 * @returns Property value or undefined
 *
 * @example
 * getNestedValue({ user: { id: '123' } }, 'user.id') // '123'
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }

  const keys = path.split('.');
  let value: unknown = obj;

  for (const key of keys) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }

  return value;
}

/**
 * Generates cache key from template and method arguments.
 *
 * Replaces {paramName} placeholders with actual parameter values.
 * Supports nested properties: {user.id}
 *
 * @param template - Key template (e.g., 'user:{id}')
 * @param method - Method being decorated
 * @param args - Method arguments
 * @param namespace - Optional namespace prefix
 * @returns Generated cache key
 *
 * @throws CacheKeyError if parameter is not found or template is invalid
 *
 * @example
 * ```typescript
 * generateKey('user:{id}', getUserMethod, ['123']) // 'user:123'
 * generateKey('user:{user.id}', updateMethod, [{ id: '456' }]) // 'user:456'
 * ```
 */
export function generateKey(
  template: string,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  method: Function,
  args: unknown[],
  namespace?: string,
): string {
  // Extract parameter names from method signature
  const paramNames = getParameterNames(method);

  // Build parameter map
  const paramMap = new Map<string, unknown>();
  paramNames.forEach((name, index) => {
    if (index < args.length) {
      paramMap.set(name, args[index]);
    }
  });

  // Replace placeholders in template
  let key = template;
  const placeholderRegex = /\{([^}]+)\}/g;
  const matches = Array.from(template.matchAll(placeholderRegex));

  if (matches.length === 0) {
    // No placeholders, return template as is
    return namespace ? `${namespace}:${template}` : template;
  }

  for (const match of matches) {
    const placeholder = match[0]; // e.g., '{id}' or '{user.id}'
    const path = match[1]; // e.g., 'id' or 'user.id'

    if (!path) {
      continue; // Skip if no path captured (shouldn't happen)
    }

    let value: unknown;

    if (path.includes('.')) {
      // Nested property access
      const [rootParam, ...nestedPath] = path.split('.');

      if (!rootParam) {
        throw new CacheKeyError(template, 'Invalid nested property path');
      }

      const rootValue = paramMap.get(rootParam);

      if (rootValue === undefined) {
        throw new CacheKeyError(template, `Parameter '${rootParam}' not found in method signature`);
      }

      value = getNestedValue(rootValue, nestedPath.join('.'));

      if (value === undefined) {
        throw new CacheKeyError(template, `Nested property '${path}' not found or is undefined`);
      }
    } else {
      // Direct parameter access
      if (!paramMap.has(path)) {
        throw new CacheKeyError(template, `Parameter '${path}' not found in method signature`);
      }

      value = paramMap.get(path);

      if (value === undefined || value === null) {
        throw new CacheKeyError(template, `Parameter '${path}' is null or undefined`);
      }
    }

    // Convert value to string
    const stringValue = String(value);

    // Validate value doesn't contain invalid characters
    if (stringValue.includes(':') || stringValue.includes('{') || stringValue.includes('}')) {
      throw new CacheKeyError(template, `Parameter value '${stringValue}' contains invalid characters (:, {, })`);
    }

    key = key.replace(placeholder, stringValue);
  }

  // Add namespace if provided
  if (namespace) {
    key = `${namespace}:${key}`;
  }

  return key;
}

/**
 * Generates multiple cache keys from templates and method arguments.
 *
 * @param templates - Array of key templates
 * @param method - Method being decorated
 * @param args - Method arguments
 * @param namespace - Optional namespace prefix
 * @returns Array of generated cache keys
 */
export function generateKeys(
  templates: string[],
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  method: Function,
  args: unknown[],
  namespace?: string,
): string[] {
  return templates.map((template) => generateKey(template, method, args, namespace));
}

/**
 * Evaluates tags - either static array or dynamic function.
 *
 * @param tags - Tags definition (array or function)
 * @param args - Method arguments
 * @returns Array of tag names
 */
export function evaluateTags(tags: string[] | ((...args: unknown[]) => string[]) | undefined, args: unknown[]): string[] {
  if (!tags) {
    return [];
  }

  if (typeof tags === 'function') {
    return tags(...args);
  }

  return tags;
}

/**
 * Evaluates condition - determines if caching should proceed.
 *
 * @param condition - Condition function
 * @param args - Method arguments
 * @returns true if caching should proceed
 */
export function evaluateCondition(condition: ((...args: unknown[]) => boolean) | undefined, args: unknown[]): boolean {
  if (!condition) {
    return true;
  }

  return condition(...args);
}
