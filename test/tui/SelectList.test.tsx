/**
 * SelectList Component Tests
 */

import React from "react";

// Mock ink components
jest.mock("ink", () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  useInput: jest.fn(),
}));

import { SelectList, SelectListItem } from "../../src/tui/components/SelectList";

// Simple render to string
function renderToString(element: React.ReactElement): { container: string } {
  const ReactDOMServer = require("react-dom/server");
  const html = ReactDOMServer.renderToStaticMarkup(element);
  // Strip HTML tags to get text content
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return { container: text };
}

// Helper to extract text content from React element
function getTextContent(element: React.ReactElement): string {
  const { container } = renderToString(element);
  return container;
}

describe("SelectList", () => {
  const mockItems: SelectListItem<string>[] = [
    { label: "Item 1", value: "item1", description: "First item" },
    { label: "Item 2", value: "item2", description: "Second item" },
    { label: "Item 3", value: "item3" },
  ];

  describe("rendering", () => {
    it("renders all items", () => {
      const output = getTextContent(
        <SelectList
          items={mockItems}
          selectedIndex={0}
          onSelect={jest.fn()}
          onIndexChange={jest.fn()}
        />
      );

      expect(output).toContain("Item 1");
      expect(output).toContain("Item 2");
      expect(output).toContain("Item 3");
    });

    it("shows descriptions when provided", () => {
      const output = getTextContent(
        <SelectList
          items={mockItems}
          selectedIndex={0}
          onSelect={jest.fn()}
          onIndexChange={jest.fn()}
        />
      );

      expect(output).toContain("First item");
      expect(output).toContain("Second item");
    });

    it("shows selection indicator on selected item", () => {
      const output = getTextContent(
        <SelectList
          items={mockItems}
          selectedIndex={1}
          onSelect={jest.fn()}
          onIndexChange={jest.fn()}
        />
      );

      // The selected item should have the indicator
      expect(output).toContain("❯");
    });

    it("shows empty message when no items", () => {
      const output = getTextContent(
        <SelectList
          items={[]}
          selectedIndex={0}
          onSelect={jest.fn()}
          onIndexChange={jest.fn()}
          emptyMessage="No items available"
        />
      );

      expect(output).toContain("No items available");
    });

    it("shows default empty message", () => {
      const output = getTextContent(
        <SelectList
          items={[]}
          selectedIndex={0}
          onSelect={jest.fn()}
          onIndexChange={jest.fn()}
        />
      );

      expect(output).toContain("No items");
    });
  });

  describe("keyboard navigation", () => {
    // Note: Full keyboard navigation tests require ink-testing-library
    // which is ESM-only and not compatible with Jest in this CJS project.
    // Manual testing instructions are available in docs/tui/README.md

    it("registers useInput hook for keyboard handling", () => {
      const { useInput } = require("ink");

      getTextContent(
        <SelectList
          items={mockItems}
          selectedIndex={0}
          onSelect={jest.fn()}
          onIndexChange={jest.fn()}
        />
      );

      // Verify useInput was called to register keyboard handlers
      expect(useInput).toHaveBeenCalled();
    });
  });
});
