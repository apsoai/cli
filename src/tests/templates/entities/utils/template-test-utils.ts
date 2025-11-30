import * as Eta from "eta";
import * as path from "path";
import { it, expect } from "@jest/globals";

/**
 * Configures Eta for template testing
 * @returns {void} Nothing
 */
export function configureEta(): void {
  Eta.configure({
    views: path.join(__dirname, "../../../../lib/templates"),
  });
}

/**
 * Renders a template file with the given field data
 * @param templatePath The relative path to the template file
 * @param field The field data to render the template with
 * @returns {Promise<string|undefined>} The rendered template
 */
export async function renderTemplate(
  templatePath: string,
  field: any
): Promise<string | undefined> {
  return Eta.renderFileAsync(templatePath, { field });
}

/**
 * Common test cases for entity templates
 */
export interface TemplateTestCase {
  name: string;
  field: any;
  assertions: Array<{
    type: "contains" | "notContains";
    text: string;
  }>;
}

/**
 * Run common test cases for a template
 *
 * @param templatePath Path to the template to test
 * @param testCases Array of test cases
 * @returns {void} Nothing
 */
export function runTemplateTests(
  templatePath: string,
  testCases: TemplateTestCase[]
): void {
  testCases.forEach((testCase) => {
    it(testCase.name, async () => {
      const rendered = await renderTemplate(templatePath, testCase.field);

      for (const assertion of testCase.assertions) {
        if (assertion.type === "contains") {
          expect(rendered).toContain(assertion.text);
        } else {
          expect(rendered).not.toContain(assertion.text);
        }
      }
    });
  });
}
