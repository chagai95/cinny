import React, { useRef, useState } from 'react';
import { Box, Text, IconButton, Icon, Icons, Scroll, Chip, config } from 'folds';
import { useAtom } from 'jotai';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { signingNameAtom } from '../../../state/signingName';

function SigningNameSetting() {
  const [storedName, setStoredName] = useAtom(signingNameAtom);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const val = inputRef.current?.value.trim() ?? '';
    setStoredName(val);
    setEditing(false);
  };

  return (
    <SettingTile
      title="Signing name"
      description={
        storedName ? (
          <>
            Messages will be signed as: <strong>{storedName}</strong>
          </>
        ) : (
          'No signing name set. Messages will not include a signature.'
        )
      }
      after={
        !editing && (
          <Chip variant="Secondary" radii="Pill" onClick={() => setEditing(true)}>
            <Text size="B300">{storedName ? 'Edit' : 'Set name'}</Text>
          </Chip>
        )
      }
    >
      {editing && (
        <Box gap="200" alignItems="Center" style={{ marginTop: config.space.S100 }}>
          <input
            ref={inputRef}
            defaultValue={storedName}
            placeholder="e.g. Joe from the Connect Bern Team"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setEditing(false);
            }}
            style={{
              flex: 1,
              background: 'var(--mx-bg-surface)',
              border: '1px solid var(--mx-bd-interactive)',
              borderRadius: config.radii.R200,
              padding: `${config.space.S100} ${config.space.S200}`,
              color: 'inherit',
              font: 'inherit',
              outline: 'none',
            }}
          />
          <Chip variant="Primary" radii="Pill" onClick={handleSave}>
            <Text size="B300">Save</Text>
          </Chip>
          <Chip variant="Surface" radii="Pill" onClick={() => setEditing(false)}>
            <Text size="B300">Cancel</Text>
          </Chip>
        </Box>
      )}
    </SettingTile>
  );
}

type SignatureProps = {
  requestClose: () => void;
};
export function Signature({ requestClose }: SignatureProps) {
  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Signature
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <Box direction="Column" gap="100">
                <Text size="L400">Message Signature</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  <SigningNameSetting />
                </SequenceCard>
                <Text size="T200" priority="300" style={{ padding: `0 ${config.space.S100}` }}>
                  Your signing name is saved locally in your browser. It persists across page
                  refreshes and only needs to be set once per device. Clearing browser storage will
                  remove it.
                </Text>
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
