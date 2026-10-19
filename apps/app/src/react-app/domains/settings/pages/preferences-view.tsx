/** @jsxImportSource react */
import { Switch } from "@/components/ui/switch";

import { t } from "@/i18n";
import { useOrgPolicy } from "../../connections/org-policy";
import { OrgPolicyNote } from "../../connections/org-policy-ui";

import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings-layout";

export type PreferencesViewProps = {
  busy: boolean;
  showThinking: boolean;
  onToggleShowThinking: () => void;
  autoCompactContext: boolean;
  autoCompactContextBusy: boolean;
  onToggleAutoCompactContext: () => void;
  analyticsEnabled: boolean;
  onToggleAnalytics: () => void;
  modelCatalogUpdatesEnabled: boolean;
  modelCatalogUpdatesBusy: boolean;
  modelCatalogUpdatesError: string | null;
  onToggleModelCatalogUpdates: () => void;
};

export function PreferencesView(props: PreferencesViewProps) {
  const analyticsLocked = useOrgPolicy("privacy.shareAnonymousUsage")?.locked === true;
  return (
    <LayoutStack>
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.privacy_title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.privacy_section_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.model_catalog_updates")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>
              {props.modelCatalogUpdatesError ?? t("settings.model_catalog_updates_desc")}
            </LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("settings.model_catalog_updates")}
                checked={props.modelCatalogUpdatesEnabled}
                disabled={props.busy || props.modelCatalogUpdatesBusy}
                onCheckedChange={props.onToggleModelCatalogUpdates}
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.analytics_toggle")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.analytics_toggle_desc")}</LayoutSectionItemDescription>
            <OrgPolicyNote policyKey="privacy.shareAnonymousUsage" />
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("settings.analytics_toggle")}
                checked={props.analyticsEnabled}
                disabled={props.busy || analyticsLocked}
                onCheckedChange={props.onToggleAnalytics}
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      </LayoutSection>
    </LayoutStack>
  );
}
