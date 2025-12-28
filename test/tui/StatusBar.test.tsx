/**
 * StatusBar Component Tests
 */

import React from "react";

// Mock ink components
jest.mock("ink", () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

// Mock ink-spinner
jest.mock("ink-spinner", () => ({
  __esModule: true,
  default: () => <span>*</span>,
}));

import { StatusBar } from "../../src/tui/components/StatusBar";

// Helper to extract text content from React element
function getTextContent(element: React.ReactElement): string {
  const { container } = renderToString(element);
  return container;
}

// Simple render to string
function renderToString(element: React.ReactElement): { container: string } {
  const ReactDOMServer = require("react-dom/server");
  const html = ReactDOMServer.renderToStaticMarkup(element);
  // Strip HTML tags to get text content
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return { container: text };
}

describe("StatusBar", () => {
  describe("loading state", () => {
    it("shows loading spinner when isLoading is true", () => {
      const output = getTextContent(
        <StatusBar
          isLoading={true}
          error={null}
          hint="Press q to quit"
        />
      );

      expect(output).toContain("Loading");
    });
  });

  describe("error state", () => {
    it("shows error message when error is provided", () => {
      const output = getTextContent(
        <StatusBar
          isLoading={false}
          error="Something went wrong"
          hint="Press q to quit"
        />
      );

      expect(output).toContain("Something went wrong");
    });

    it("prioritizes loading over error", () => {
      const output = getTextContent(
        <StatusBar
          isLoading={true}
          error="Something went wrong"
          hint="Press q to quit"
        />
      );

      expect(output).toContain("Loading");
      expect(output).not.toContain("Something went wrong");
    });
  });

  describe("ready state", () => {
    it("shows ready indicator when not loading and no error", () => {
      const output = getTextContent(
        <StatusBar
          isLoading={false}
          error={null}
          hint="Press q to quit"
        />
      );

      expect(output).toContain("Ready");
    });
  });

  describe("hint display", () => {
    it("always shows the hint text", () => {
      const output = getTextContent(
        <StatusBar
          isLoading={false}
          error={null}
          hint="Navigate | Quit"
        />
      );

      expect(output).toContain("Navigate");
      expect(output).toContain("Quit");
    });
  });
});
