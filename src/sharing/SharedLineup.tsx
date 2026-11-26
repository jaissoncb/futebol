import { type PublicLineup } from './contracts'
import { lineupDate, playerCount, playerLabel, teamAccent } from './lineup'

export function Lineup({ snapshot, headingLevel = 2 }: { snapshot: PublicLineup; headingLevel?: 2 | 5 }) {
  const date = lineupDate(snapshot)
  const TeamHeading = headingLevel === 2 ? 'h2' : 'h5'
  const RoleHeading = headingLevel === 2 ? 'h3' : 'h6'
  return <>
    {snapshot.groupName && <p className="share-group">{snapshot.groupName}</p>}
    {date && <p className="share-date"><time dateTime={snapshot.matchDate}>{date}</time></p>}
    <div className="shared-teams">{snapshot.teams.map((team, index) =>
      <article className="shared-team" key={index} style={{ borderTopColor: teamAccent(team.color) }}>
        <TeamHeading className="shared-team-name">Time {team.name}</TeamHeading>
        <p className="shared-team-count">{playerCount(team.players.length)}</p>
        {[false, true].map(reserve => {
          const players = team.players.filter(player => player.reserve === reserve)
          return players.length > 0 && <section key={String(reserve)}>
            <RoleHeading className="shared-team-role">{reserve ? 'Reservas' : 'Titulares'}</RoleHeading>
            <ul>{players.map((player, index) => <li key={index}>{playerLabel(player)}</li>)}</ul>
          </section>
        })}
      </article>,
    )}</div>
  </>
}
