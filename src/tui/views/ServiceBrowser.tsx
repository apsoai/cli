/**
 * Service Browser View
 *
 * Displays list of services in a workspace.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { SelectList, SelectListItem } from "../components/SelectList";
import { servicesApi } from "../../lib/api/services";
import { Workspace, Service } from "../../lib/api/types";

interface ServiceBrowserProps {
  workspace: Workspace;
  onSelect: (service: Service) => void;
  onBack: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export function ServiceBrowser({
  workspace,
  onSelect,
  setLoading,
  setError,
}: ServiceBrowserProps): React.ReactElement {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function fetchServices(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const response = await servicesApi.list(workspace.slug);
        setServices(response.data);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load services");
      } finally {
        setLoading(false);
      }
    }

    fetchServices();
  }, [workspace.slug, setLoading, setError]);

  const items: SelectListItem<Service>[] = services.map((svc) => ({
    label: svc.name,
    value: svc,
    description: getServiceDescription(svc),
  }));

  if (!loaded) {
    return (
      <Box>
        <Text dimColor>Loading services...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>
          Services in <Text bold color="cyan">{workspace.name}</Text>:
        </Text>
      </Box>
      <SelectList
        items={items}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
        onIndexChange={setSelectedIndex}
        emptyMessage="No services found. Create one with 'apso server new'"
      />
    </Box>
  );
}

function getServiceDescription(service: Service): string {
  const parts: string[] = [];

  if (service.status) {
    parts.push(service.status);
  }

  if (service.githubRepo) {
    parts.push(service.githubRepo);
  }

  return parts.join(" • ");
}
