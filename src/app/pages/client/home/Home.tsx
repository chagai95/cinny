import React, { MouseEventHandler, forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  config,
  toRem,
} from 'folds';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtom, useAtomValue } from 'jotai';
import FocusTrap from 'focus-trap-react';
import { factoryRoomIdByActivity } from '../../../utils/sort';
import {
  NavCategory,
  NavCategoryHeader,
  NavEmptyCenter,
  NavEmptyLayout,
  NavItem,
  NavItemContent,
  NavLink,
} from '../../../components/nav';
import {
  getHomeRoomPath,
  getHomeSearchPath,
} from '../../pathUtils';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useHomeSearchSelected } from '../../../hooks/router/useHomeSelected';
import { useHomeRooms } from './useHomeRooms';
import { useDirectRooms } from '../direct/useDirectRooms';
import { mDirectAtom } from '../../../state/mDirectList';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { VirtualTile } from '../../../components/virtualizer';
import { RoomNavCategoryButton, RoomNavItem } from '../../../features/room-nav';
import { makeNavCategoryId } from '../../../state/closedNavCategories';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useCategoryHandler } from '../../../hooks/useCategoryHandler';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { PageNav, PageNavHeader, PageNavContent } from '../../../components/page';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { markAsRead } from '../../../utils/notifications';
import { useClosedNavCategoriesAtom } from '../../../state/hooks/closedNavCategories';
import { stopPropagation } from '../../../utils/keyboard';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  getRoomNotificationMode,
  RoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { allInvitesAtom } from '../../../state/room-list/inviteList';
import { guessDmRoomUserId, addRoomIdToMDirect } from '../../../utils/matrix';
import { isDirectInvite } from '../../../utils/room';

type HomeMenuProps = {
  requestClose: () => void;
};
const HomeMenu = forwardRef<HTMLDivElement, HomeMenuProps>(({ requestClose }, ref) => {
  const orphanRooms = useHomeRooms();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const unread = useRoomsUnread(orphanRooms, roomToUnreadAtom);
  const mx = useMatrixClient();

  const handleMarkAsRead = () => {
    if (!unread) return;
    orphanRooms.forEach((rId) => markAsRead(mx, rId, hideActivity));
    requestClose();
  };

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MenuItem
          onClick={handleMarkAsRead}
          size="300"
          after={<Icon size="100" src={Icons.CheckTwice} />}
          radii="300"
          aria-disabled={!unread}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Mark all chats as read
          </Text>
        </MenuItem>
      </Box>
    </Menu>
  );
});

function HomeHeader() {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300">
          <Box grow="Yes">
            <Text size="H4" truncate>
              Home
            </Text>
          </Box>
          <Box>
            <IconButton aria-pressed={!!menuAnchor} variant="Background" onClick={handleOpenMenu}>
              <Icon src={Icons.VerticalDots} size="200" />
            </IconButton>
          </Box>
        </Box>
      </PageNavHeader>
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <HomeMenu requestClose={() => setMenuAnchor(undefined)} />
          </FocusTrap>
        }
      />
    </>
  );
}

function HomeEmpty() {
  return (
    <NavEmptyCenter>
      <NavEmptyLayout
        icon={<Icon size="600" src={Icons.Message} />}
        title={
          <Text size="H5" align="Center">
            No Chats
          </Text>
        }
        content={
          <Text size="T300" align="Center">
            You do not have any chats yet.
          </Text>
        }
      />
    </NavEmptyCenter>
  );
}

const DEFAULT_CATEGORY_ID = makeNavCategoryId('home', 'room');
export function Home() {
  const mx = useMatrixClient();
  useNavToActivePathMapper('home');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rooms = useHomeRooms();
  const directs = useDirectRooms();
  const mDirects = useAtomValue(mDirectAtom);
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const allInvites = useAtomValue(allInvitesAtom);
  const [joiningRooms, setJoiningRooms] = useState<Set<string>>(new Set());

  const handleAcceptInvite = useCallback(
    async (roomId: string) => {
      setJoiningRooms((s) => new Set(s).add(roomId));
      try {
        const room = mx.getRoom(roomId);
        const userId = mx.getSafeUserId();
        const dmUserId =
          room && isDirectInvite(room, userId) ? guessDmRoomUserId(room, userId) : undefined;
        await mx.joinRoom(roomId);
        if (dmUserId) await addRoomIdToMDirect(mx, roomId, dmUserId);
      } catch {
        setJoiningRooms((s) => { const n = new Set(s); n.delete(roomId); return n; });
      }
    },
    [mx]
  );

  const handleDeclineInvite = useCallback(
    (roomId: string) => mx.leave(roomId).catch(() => undefined),
    [mx]
  );

  const selectedRoomId = useSelectedRoom();
  const searchSelected = useHomeSearchSelected();
  const noRoomToDisplay = rooms.length === 0 && directs.length === 0;
  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());
  const [hideActivityDots] = useSetting(settingsAtom, 'hideUnreadActivityDots');
  const collapsed = closedCategories.has(DEFAULT_CATEGORY_ID);

  const sortedAll = useMemo(() => {
    const all = [...Array.from(rooms), ...Array.from(directs)];
    const byActivity = all.sort(factoryRoomIdByActivity(mx));

    const getRank = (rId: string) => {
      const isMuted =
        getRoomNotificationMode(notificationPreferences, rId) === RoomNotificationMode.Mute;
      if (isMuted) return 2;
      const room = mx.getRoom(rId);
      const isLargeGroup = !mDirects.has(rId) && (room?.getJoinedMemberCount() ?? 0) > 5;
      if (isLargeGroup) return 1;
      return 0;
    };

    const sorted = byActivity.sort((a, b) => getRank(a) - getRank(b));

    if (collapsed) {
      return sorted.filter((rId) => {
        const u = roomToUnread.get(rId);
        const isUnread = hideActivityDots
          ? u !== undefined && (u.total > 0 || u.highlight > 0)
          : roomToUnread.has(rId);
        return isUnread || rId === selectedRoomId;
      });
    }
    return sorted;
  }, [mx, rooms, directs, collapsed, roomToUnread, selectedRoomId, hideActivityDots, notificationPreferences, mDirects]);

  const virtualizer = useVirtualizer({
    count: sortedAll.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 10,
  });

  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );

  return (
    <PageNav>
      <HomeHeader />
      {noRoomToDisplay ? (
        <HomeEmpty />
      ) : (
        <PageNavContent scrollRef={scrollRef}>
          <Box direction="Column" gap="300">
            <NavCategory>
              <NavItem variant="Background" radii="400" aria-selected={searchSelected}>
                <NavLink to={getHomeSearchPath()}>
                  <NavItemContent>
                    <Box as="span" grow="Yes" alignItems="Center" gap="200">
                      <Avatar size="200" radii="400">
                        <Icon src={Icons.Search} size="100" filled={searchSelected} />
                      </Avatar>
                      <Box as="span" grow="Yes">
                        <Text as="span" size="Inherit" truncate>
                          Message Search
                        </Text>
                      </Box>
                    </Box>
                  </NavItemContent>
                </NavLink>
              </NavItem>
            </NavCategory>
            {allInvites.length > 0 && (
              <NavCategory>
                <NavCategoryHeader>
                  <Text size="L400" style={{ padding: `0 ${config.space.S200}`, opacity: 0.7, fontWeight: 600 }}>
                    Invites ({allInvites.length})
                  </Text>
                </NavCategoryHeader>
                {allInvites.map((roomId) => {
                  const room = mx.getRoom(roomId);
                  if (!room) return null;
                  const joining = joiningRooms.has(roomId);
                  return (
                    <NavItem key={roomId} variant="Background" radii="400">
                      <NavItemContent>
                        <Box as="span" grow="Yes" alignItems="Center" gap="200">
                          <Box as="span" grow="Yes">
                            <Text as="span" size="T300" truncate>
                              {room.name}
                            </Text>
                          </Box>
                          <Box shrink="No" gap="100">
                            <button
                              type="button"
                              disabled={joining}
                              onClick={() => handleAcceptInvite(roomId)}
                              style={{
                                all: 'unset',
                                cursor: joining ? 'default' : 'pointer',
                                padding: `${config.space.S100} ${config.space.S200}`,
                                borderRadius: config.radii.R200,
                                background: 'var(--mx-bg-positive)',
                                color: 'var(--mx-tc-on-positive)',
                                fontSize: '0.75em',
                                fontWeight: 600,
                                opacity: joining ? 0.5 : 1,
                              }}
                            >
                              {joining ? '…' : 'Accept'}
                            </button>
                            <button
                              type="button"
                              disabled={joining}
                              onClick={() => handleDeclineInvite(roomId)}
                              style={{
                                all: 'unset',
                                cursor: 'pointer',
                                padding: `${config.space.S100} ${config.space.S200}`,
                                borderRadius: config.radii.R200,
                                background: 'var(--mx-bg-critical)',
                                color: 'var(--mx-tc-on-critical)',
                                fontSize: '0.75em',
                                fontWeight: 600,
                              }}
                            >
                              Decline
                            </button>
                          </Box>
                        </Box>
                      </NavItemContent>
                    </NavItem>
                  );
                })}
              </NavCategory>
            )}
            <NavCategory>
              <NavCategoryHeader>
                <RoomNavCategoryButton
                  closed={collapsed}
                  data-category-id={DEFAULT_CATEGORY_ID}
                  onClick={handleCategoryClick}
                >
                  {collapsed ? 'Unread' : 'All Chats'}
                </RoomNavCategoryButton>
              </NavCategoryHeader>
              <div
                style={{
                  position: 'relative',
                  height: virtualizer.getTotalSize(),
                }}
              >
                {virtualizer.getVirtualItems().map((vItem) => {
                  const roomId = sortedAll[vItem.index];
                  const room = mx.getRoom(roomId);
                  if (!room) return null;
                  const selected = selectedRoomId === roomId;
                  const isDirect = mDirects.has(roomId);

                  return (
                    <VirtualTile
                      virtualItem={vItem}
                      key={vItem.index}
                      ref={virtualizer.measureElement}
                    >
                      <RoomNavItem
                        room={room}
                        selected={selected}
                        showAvatar
                        direct={isDirect}
                        linkPath={getHomeRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                        notificationMode={getRoomNotificationMode(
                          notificationPreferences,
                          room.roomId
                        )}
                      />
                    </VirtualTile>
                  );
                })}
              </div>
            </NavCategory>
          </Box>
        </PageNavContent>
      )}
    </PageNav>
  );
}
