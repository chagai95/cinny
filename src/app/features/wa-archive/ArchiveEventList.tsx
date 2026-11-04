import React, { useMemo } from 'react';
import { Room } from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { Avatar, Box, Text, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeHighlightRegex,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../hooks/useSpoilerClickHandler';
import {
  AvatarBase,
  ImageContent,
  MSticker,
  ModernLayout,
  RedactedContent,
  Time,
  Username,
  UsernameBold,
} from '../../components/message';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { Image } from '../../components/media';
import { ImageViewer } from '../../components/image-viewer';
import { UserAvatar, UserInitials } from '../../components/user-avatar';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { GetContentCallback, MessageEvent } from '../../../types/matrix/room';
import colorMXID from '../../../util/colorMXID';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { ArchiveEvent, ArchiveProfiles } from './api';

type ArchiveEventListProps = {
  /** the CURRENT chat (for mentions / link handling) */
  room: Room;
  events: ArchiveEvent[];
  profiles: ArchiveProfiles;
  highlights?: string[];
};

/**
 * Read-only rendering of archived messages: sender, time and the message the
 * same way the timeline shows it — no reply, reaction or menu.
 */
export function ArchiveEventList({ room, events, profiles, highlights }: ArchiveEventListProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');
  const highlightRegex = useMemo(
    () => (highlights && highlights.length > 0 ? makeHighlightRegex(highlights) : undefined),
    [highlights]
  );
  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const spoilerClickHandler = useSpoilerClickHandler();
  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler))
      ),
    }),
    [mx, room, mentionClickHandler]
  );
  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts,
        highlightRegex,
        useAuthentication,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
      }),
    [
      mx,
      room,
      linkifyOpts,
      highlightRegex,
      mentionClickHandler,
      spoilerClickHandler,
      useAuthentication,
    ]
  );

  return (
    <Box direction="Column" gap="100">
      {events.map((event) => {
        const profile = profiles[event.room_id]?.[event.sender];
        const displayName = profile?.displayname ?? getMxIdLocalPart(event.sender) ?? event.sender;
        const avatarMxc = profile?.avatar_url;
        const getContent = (() => event.content) as GetContentCallback;
        const redacted = event.unsigned?.redacted_because;
        let body: React.ReactNode;
        if (redacted) {
          body = <RedactedContent reason={redacted.content?.reason} />;
        } else if (event.type === MessageEvent.Sticker) {
          body = (
            <MSticker
              content={getContent()}
              renderImageContent={(props) => (
                <ImageContent
                  {...props}
                  autoPlay={mediaAutoLoad}
                  renderImage={(p) => <Image {...p} loading="lazy" />}
                  renderViewer={(p) => <ImageViewer {...p} />}
                />
              )}
            />
          );
        } else {
          body = (
            <RenderMessageContent
              displayName={displayName}
              msgType={event.content?.msgtype ?? ''}
              ts={event.origin_server_ts}
              edited={!!event.unsigned?.['chagai.edited']}
              getContent={getContent}
              mediaAutoLoad={mediaAutoLoad}
              urlPreview={false}
              htmlReactParserOptions={htmlReactParserOptions}
              linkifyOpts={linkifyOpts}
              highlightRegex={highlightRegex}
              outlineAttachment
            />
          );
        }
        return (
          <Box
            key={event.event_id}
            data-archive-event-id={event.event_id}
            direction="Column"
            style={{ padding: `${config.space.S200} ${config.space.S400}` }}
          >
            <ModernLayout
              before={
                <AvatarBase>
                  <Avatar size="300">
                    <UserAvatar
                      userId={event.sender}
                      src={
                        avatarMxc
                          ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 48, 48, 'crop') ??
                            undefined
                          : undefined
                      }
                      alt={displayName}
                      renderFallback={() => <UserInitials name={displayName} />}
                    />
                  </Avatar>
                </AvatarBase>
              }
            >
              <Box gap="200" alignItems="Baseline">
                <Username style={{ color: colorMXID(event.sender) }}>
                  <Text as="span" truncate>
                    <UsernameBold>{displayName}</UsernameBold>
                  </Text>
                </Username>
                <Time
                  ts={event.origin_server_ts}
                  hour24Clock={hour24Clock}
                  dateFormatString={dateFormatString}
                />
              </Box>
              {body}
            </ModernLayout>
          </Box>
        );
      })}
    </Box>
  );
}
