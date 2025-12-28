/**
 * Layout Component
 *
 * Main layout with header, content area, and optional sidebar.
 */

import React from "react";
import { Box, Text } from "ink";

interface LayoutProps {
  title: string;
  breadcrumb: string[];
  children: React.ReactNode;
}

export function Layout({
  title,
  breadcrumb,
  children,
}: LayoutProps): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box
        borderStyle="single"
        borderBottom={true}
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
      >
        <Box flexGrow={1}>
          <Text bold color="cyan">
            {title}
          </Text>
        </Box>
        <Box>
          <Breadcrumb items={breadcrumb} />
        </Box>
      </Box>

      {/* Content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        {children}
      </Box>
    </Box>
  );
}

interface BreadcrumbProps {
  items: string[];
}

function Breadcrumb({ items }: BreadcrumbProps): React.ReactElement {
  return (
    <Text dimColor>
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <Text color="gray"> › </Text>}
          <Text>{item}</Text>
        </React.Fragment>
      ))}
    </Text>
  );
}
