import React, { FormEventHandler, useMemo, useState } from 'react';
import {
  Box,
  Button,
  color,
  config,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Spinner,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { stopPropagation } from '../../utils/keyboard';
import { normalizePhone } from './normalizePhone';
import { useStartWhatsAppChat } from './useStartWhatsAppChat';

type StartWhatsAppChatDialogProps = {
  requestClose: () => void;
};

/**
 * Dialog: a phone-number input + live E.164 preview + "Start WhatsApp chat".
 *
 * As the user types we normalize the number and show the primary E.164 result
 * plus, for bare/local numbers, the ordered list of country candidates (so it is
 * obvious we default to Switzerland but will try neighbours). Submitting sends
 * `!wa pm <e164>` to the bridge bot and navigates to the resulting chat.
 */
export function StartWhatsAppChatDialog({ requestClose }: StartWhatsAppChatDialogProps) {
  const [raw, setRaw] = useState('');
  const { start, loading, error } = useStartWhatsAppChat();

  const normalized = useMemo(() => normalizePhone(raw), [raw]);
  const hasNumber = normalized.e164.length > 0;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (!hasNumber || loading) return;
    start(normalized.e164);
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: true,
            onDeactivate: requestClose,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Modal size="300" flexHeight>
            <Box direction="Column">
              <Header
                size="500"
                style={{ padding: config.space.S200, paddingLeft: config.space.S400 }}
              >
                <Box grow="Yes" alignItems="Center" gap="200">
                  <Icon size="400" src={Icons.Phone} />
                  <Text size="H4">Start WhatsApp chat</Text>
                </Box>
                <Box shrink="No">
                  <IconButton size="300" radii="300" onClick={requestClose}>
                    <Icon src={Icons.Cross} />
                  </IconButton>
                </Box>
              </Header>
              <Scroll size="300" hideTrack>
                <Box
                  as="form"
                  onSubmit={handleSubmit}
                  direction="Column"
                  gap="400"
                  style={{ padding: config.space.S400 }}
                >
                  <Box direction="Column" gap="100">
                    <Text size="L400">Phone number</Text>
                    <Input
                      value={raw}
                      onChange={(evt) => setRaw(evt.currentTarget.value)}
                      placeholder="e.g. 079 123 45 67 or +49 151 …"
                      name="waNumberInput"
                      variant="SurfaceVariant"
                      size="500"
                      radii="400"
                      autoFocus
                      autoComplete="off"
                      inputMode="tel"
                      disabled={loading}
                      required
                    />
                    <Text size="T200" priority="300">
                      Any format works — spaces, dashes, brackets, leading 00 or +. No country code
                      assumes Switzerland (+41) first.
                    </Text>
                  </Box>

                  {hasNumber && (
                    <Box direction="Column" gap="100">
                      <Text size="L400">Will message</Text>
                      <Text size="H5">{normalized.e164}</Text>
                      {!normalized.wasInternational && normalized.candidates.length > 1 && (
                        <Text size="T200" priority="300">
                          If wrong, other guesses: {normalized.candidates.slice(1).join('  ·  ')}
                        </Text>
                      )}
                    </Box>
                  )}

                  {error && (
                    <Box alignItems="Center" gap="200" style={{ color: color.Critical.Main }}>
                      <Icon src={Icons.Warning} filled size="100" />
                      <Text size="T300" style={{ color: color.Critical.Main }}>
                        <b>{error.message}</b>
                      </Text>
                    </Box>
                  )}

                  <Box shrink="No" direction="Column" gap="200">
                    <Button
                      type="submit"
                      size="500"
                      variant="Primary"
                      radii="400"
                      disabled={!hasNumber || loading}
                      before={
                        loading ? (
                          <Spinner variant="Primary" fill="Solid" size="200" />
                        ) : (
                          <Icon size="200" src={Icons.Phone} filled />
                        )
                      }
                    >
                      <Text size="B500">Start WhatsApp chat</Text>
                    </Button>
                  </Box>
                </Box>
              </Scroll>
            </Box>
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
