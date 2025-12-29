export { BaseGenerator } from "./base";
export { TypeScriptGenerator } from "./typescript";
export { PythonGenerator } from "./python";
export { GoGenerator } from "./go";

import { TargetLanguage, GeneratorConfig, LanguageGenerator } from "../types";
import { TypeScriptGenerator } from "./typescript";
import { PythonGenerator } from "./python";
import { GoGenerator } from "./go";

/**
 * Factory function to create the appropriate generator for the target language
 */
export function createGenerator(config: GeneratorConfig): LanguageGenerator {
  switch (config.language) {
    case "typescript":
      return new TypeScriptGenerator(config);
    case "python":
      return new PythonGenerator(config);
    case "go":
      return new GoGenerator(config);
    default:
      throw new Error(`Unsupported language: ${config.language}`);
  }
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(language: string): language is TargetLanguage {
  return ["typescript", "python", "go"].includes(language);
}

/**
 * Get list of all supported languages
 */
export function getSupportedLanguages(): TargetLanguage[] {
  return ["typescript", "python", "go"];
}

/**
 * Get list of currently implemented languages
 */
export function getImplementedLanguages(): TargetLanguage[] {
  return ["typescript", "python", "go"];
}
