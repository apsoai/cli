/**
 * Workspace Browser View
 *
 * Displays list of workspaces the user has access to.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { SelectList, SelectListItem } from "../components/SelectList";
import { workspacesApi } from "../../lib/api/services";
import { Workspace } from "../../lib/api/types";

interface WorkspaceBrowserProps {
  onSelect: (workspace: Workspace) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export function WorkspaceBrowser({
  onSelect,
  setLoading,
  setError,
}: WorkspaceBrowserProps): React.ReactElement {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function fetchWorkspaces(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const data = await workspacesApi.list();
        setWorkspaces(data);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load workspaces");
      } finally {
        setLoading(false);
      }
    }

    fetchWorkspaces();
  }, [setLoading, setError]);

  const items: SelectListItem<Workspace>[] = workspaces.map((ws) => ({
    label: ws.name,
    value: ws,
    description: ws.slug,
  }));

  if (!loaded) {
    return (
      <Box>
        <Text dimColor>Loading workspaces...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>Select a workspace to browse:</Text>
      </Box>
      <SelectList
        items={items}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
        onIndexChange={setSelectedIndex}
        emptyMessage="No workspaces found. Create one at app.apso.ai"
      />
    </Box>
  );
}
