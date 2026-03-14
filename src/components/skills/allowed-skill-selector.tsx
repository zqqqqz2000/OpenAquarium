import { useEffect, useMemo, useState } from "react";

import { RefreshCw, X } from "lucide-react";

import { normalizeAllowedSkillIds } from "@/lib/skills";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SkillOption {
  id: string;
  directoryPath: string;
  entryPath: string;
  hasEntry: boolean;
}

function toText(skillIds: string[]): string {
  return normalizeAllowedSkillIds(skillIds).join("\n");
}

function parseText(text: string): string[] {
  return normalizeAllowedSkillIds(text.split(/[,\n]/u));
}

export function AllowedSkillSelector(props: {
  valueText: string;
  onChangeText: (nextValue: string) => void;
  description?: string;
}) {
  const { valueText, onChangeText, description } = props;
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [loading, setLoading] = useState(false);
  const selectedIds = useMemo(() => parseText(valueText), [valueText]);
  const availableIds = useMemo(
    () => skills.map((skill) => skill.id).filter((skillId) => !selectedIds.includes(skillId)),
    [selectedIds, skills],
  );

  async function loadSkills() {
    setLoading(true);
    try {
      const client = new WorkspaceRuntimeClient();
      const response = await client.listSkills();
      setSkills(response.skills);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSkills();
  }, []);

  const unknownIds = selectedIds.filter((skillId) => skills.every((skill) => skill.id !== skillId));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          value=""
          onValueChange={(nextSkillId) => onChangeText(toText([...selectedIds, nextSkillId]))}
          disabled={loading}
        >
          <SelectTrigger>
            <SelectValue placeholder={loading ? "Loading skills..." : "Select a skill"} />
          </SelectTrigger>
          <SelectContent>
            {availableIds.length === 0 ? (
              <SelectItem value="__empty" disabled>No more skills available</SelectItem>
            ) : availableIds.map((skillId) => (
              <SelectItem key={skillId} value={skillId}>{skillId}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="secondary" size="sm" onClick={() => void loadSkills()} disabled={loading}>
          <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {selectedIds.length === 0 ? <Badge variant="outline">No skills selected</Badge> : null}
        {selectedIds.map((skillId) => {
          const known = skills.find((skill) => skill.id === skillId);
          return (
            <Badge key={skillId} variant={known ? "secondary" : "outline"} className="gap-1 pr-1">
              {skillId}
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full"
                aria-label={`Remove ${skillId}`}
                onClick={() => onChangeText(toText(selectedIds.filter((candidate) => candidate !== skillId)))}
              >
                <X size={12} />
              </button>
            </Badge>
          );
        })}
      </div>

      {description ? <p className="m-0 text-sm text-muted-foreground">{description}</p> : null}
      {unknownIds.length > 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          Unknown ids kept as-is: {unknownIds.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
