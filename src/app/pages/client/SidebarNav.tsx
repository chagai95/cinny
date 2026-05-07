import React, { useRef, useState } from 'react';
import { Scroll, Box, Text, Icon, Icons, config, PopOut, RectCords } from 'folds';
import { useAtom } from 'jotai';

import {
  Sidebar,
  SidebarContent,
  SidebarStackSeparator,
  SidebarStack,
  SidebarItem,
  SidebarItemTooltip,
  SidebarAvatar,
} from '../../components/sidebar';
import {
  HomeTab,
  InboxTab,
  SettingsTab,
  UnverifiedTab,
  SearchTab,
} from './sidebar';
import { signingNameAtom } from '../../state/signingName';

function SigningNameTab() {
  const [anchor, setAnchor] = useState<RectCords>();
  const [signingName, setSigningName] = useAtom(signingNameAtom);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    const btn = document.activeElement as HTMLElement;
    const cords = btn.getBoundingClientRect();
    setAnchor((cur) => (cur ? undefined : cords));
  };

  const handleSave = () => {
    const val = inputRef.current?.value.trim() ?? '';
    setSigningName(val);
    setAnchor(undefined);
  };

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip="Signing name">
        {(ref) => (
          <SidebarAvatar as="button" ref={ref} onClick={handleClick} aria-pressed={!!anchor}>
            <Icon src={Icons.Pencil} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {anchor && (
        <PopOut
          anchor={anchor}
          position="Right"
          align="Start"
          offset={8}
          content={
            <Box
              direction="Column"
              gap="200"
              style={{
                background: 'var(--mx-bg-surface)',
                border: '1px solid var(--mx-bd-interactive)',
                borderRadius: config.radii.R300,
                padding: config.space.S300,
                minWidth: '220px',
                boxShadow: 'var(--mx-shadow-E300)',
              }}
            >
              <Text size="L400" style={{ fontWeight: 600 }}>
                Signing name
              </Text>
              <input
                ref={inputRef}
                defaultValue={signingName}
                placeholder="e.g. Joe"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') setAnchor(undefined);
                }}
                style={{
                  background: 'var(--mx-bg-surface-variant)',
                  border: '1px solid var(--mx-bd-interactive)',
                  borderRadius: config.radii.R200,
                  padding: `${config.space.S100} ${config.space.S200}`,
                  color: 'inherit',
                  font: 'inherit',
                  width: '100%',
                  outline: 'none',
                }}
              />
              <Box gap="200" justifyContent="End">
                <button
                  type="button"
                  onClick={() => setAnchor(undefined)}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    padding: `${config.space.S100} ${config.space.S200}`,
                    borderRadius: config.radii.R200,
                    opacity: 0.6,
                    fontSize: 'inherit',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    padding: `${config.space.S100} ${config.space.S200}`,
                    borderRadius: config.radii.R200,
                    background: 'var(--mx-bg-primary)',
                    color: 'var(--mx-tc-on-primary)',
                    fontWeight: 600,
                    fontSize: 'inherit',
                  }}
                >
                  Save
                </button>
              </Box>
            </Box>
          }
        />
      )}
    </SidebarItem>
  );
}

export function SidebarNav() {
  return (
    <Sidebar>
      <SidebarContent
        scrollable={
          <Scroll variant="Background" size="0">
            <SidebarStack>
              <HomeTab />
              <SigningNameTab />
            </SidebarStack>
          </Scroll>
        }
        sticky={
          <>
            <SidebarStackSeparator />
            <SidebarStack>
              <SearchTab />
              <UnverifiedTab />
              <InboxTab />
              <SettingsTab />
            </SidebarStack>
          </>
        }
      />
    </Sidebar>
  );
}
