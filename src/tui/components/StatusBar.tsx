/**
 * Status Bar Component
 *
 * Bottom status bar showing loading state, errors, and keyboard hints.
 */

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface StatusBarProps {
  isLoading: boolean;
  error: string | null;
  hint: string;
}

export function StatusBar({
  isLoading,
  error,
  hint,
}: StatusBarProps): React.ReactElement {
  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Box flexGrow={1}>
        {isLoading ? (
          <Text color="yellow">
            <Spinner type="dots" /> Loading...
          </Text>
        ) : error ? (
          <Text color="red">✗ {error}</Text>
        ) : (
          <Text color="green">✓ Ready</Text>
        )}
      </Box>
      <Box>
        <Text dimColor>{hint}</Text>
      </Box>
    </Box>
  );
}
