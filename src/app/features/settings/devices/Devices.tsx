import React, { useRef, useState } from 'react';
import { Box, Text, IconButton, Icon, Icons, Scroll, Chip } from 'folds';
import { useAtom } from 'jotai';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { signingNameAtom } from '../../../state/signingName';
import { config } from 'folds';
import { useDeviceIds, useDeviceList, useSplitCurrentDevice } from '../../../hooks/useDeviceList';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { LocalBackup } from './LocalBackup';
import { DeviceLogoutBtn, DeviceKeyDetails, DeviceTile, DeviceTilePlaceholder } from './DeviceTile';
import { OtherDevices } from './OtherDevices';
import {
  DeviceVerificationOptions,
  EnableVerification,
  VerificationStatusBadge,
  VerifyCurrentDeviceTile,
} from './Verification';
import {
  useDeviceVerificationStatus,
  useUnverifiedDeviceCount,
  VerificationStatus,
} from '../../../hooks/useDeviceVerificationStatus';
import {
  useSecretStorageDefaultKeyId,
  useSecretStorageKeyContent,
} from '../../../hooks/useSecretStorage';
import { useCrossSigningActive } from '../../../hooks/useCrossSigning';
import { BackupRestoreTile } from '../../../components/BackupRestore';

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
      title="Message Signing Name"
      description={
        <>
          The name shown at the bottom of outgoing messages as a signature. Leave blank to use your
          device name. Current:{' '}
          <strong>{storedName || 'device name'}</strong>
        </>
      }
      after={
        !editing && (
          <Chip variant="Secondary" radii="Pill" onClick={() => setEditing(true)}>
            <Text size="B300">Edit</Text>
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

function DevicesPlaceholder() {
  return (
    <Box direction="Column" gap="100">
      <DeviceTilePlaceholder />
      <DeviceTilePlaceholder />
    </Box>
  );
}

type DevicesProps = {
  requestClose: () => void;
};
export function Devices({ requestClose }: DevicesProps) {
  const mx = useMatrixClient();
  const crypto = mx.getCrypto();
  const crossSigningActive = useCrossSigningActive();
  const [devices, refreshDeviceList] = useDeviceList();

  const [currentDevice, otherDevices] = useSplitCurrentDevice(devices);
  const verificationStatus = useDeviceVerificationStatus(
    crypto,
    mx.getSafeUserId(),
    currentDevice?.device_id
  );

  const otherDevicesId = useDeviceIds(otherDevices);
  const unverifiedDeviceCount = useUnverifiedDeviceCount(
    crypto,
    mx.getSafeUserId(),
    otherDevicesId
  );

  const defaultSecretStorageKeyId = useSecretStorageDefaultKeyId();
  const defaultSecretStorageKeyContent = useSecretStorageKeyContent(
    defaultSecretStorageKeyId ?? ''
  );

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Devices
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
                <Text size="L400">Security</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  <SettingTile
                    title="Device Verification"
                    description="To verify device identity and grant access to encrypted messages."
                    after={
                      <>
                        <EnableVerification visible={!crossSigningActive} />
                        {crossSigningActive && (
                          <Box gap="200" alignItems="Center">
                            <VerificationStatusBadge
                              verificationStatus={verificationStatus}
                              otherUnverifiedCount={unverifiedDeviceCount}
                            />
                            <DeviceVerificationOptions />
                          </Box>
                        )}
                      </>
                    }
                  />
                </SequenceCard>
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">Message Signing</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  <SigningNameSetting />
                </SequenceCard>
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">Current</Text>
                {currentDevice ? (
                  <SequenceCard
                    className={SequenceCardStyle}
                    variant="SurfaceVariant"
                    direction="Column"
                    gap="400"
                  >
                    <DeviceTile
                      device={currentDevice}
                      refreshDeviceList={refreshDeviceList}
                      options={<DeviceLogoutBtn />}
                    >
                      {crypto && <DeviceKeyDetails crypto={crypto} />}
                    </DeviceTile>
                    {crossSigningActive &&
                      verificationStatus === VerificationStatus.Unverified &&
                      defaultSecretStorageKeyId &&
                      defaultSecretStorageKeyContent && (
                        <VerifyCurrentDeviceTile
                          secretStorageKeyId={defaultSecretStorageKeyId}
                          secretStorageKeyContent={defaultSecretStorageKeyContent}
                        />
                      )}
                    {crypto && verificationStatus === VerificationStatus.Verified && (
                      <BackupRestoreTile crypto={crypto} />
                    )}
                  </SequenceCard>
                ) : (
                  <DeviceTilePlaceholder />
                )}
              </Box>
              {devices === undefined && <DevicesPlaceholder />}
              {otherDevices && (
                <OtherDevices
                  devices={otherDevices}
                  refreshDeviceList={refreshDeviceList}
                  showVerification={
                    crossSigningActive && verificationStatus === VerificationStatus.Verified
                  }
                />
              )}
              <LocalBackup />
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
