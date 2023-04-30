import React, {useState} from "react"
import { Button } from "react-bootstrap";
import { FontAwesomeIcon as Icon } from '@fortawesome/react-fontawesome'
import { faPause, faPlay, faStepForward, faStop, faQuestionCircle } from '@fortawesome/free-solid-svg-icons'

import type { SimState } from "./SimulatorUI";
import HelpModal from "./HelpModal";
import "./Controls.css"

type Props = {
    state: SimState,
    /** Speed of the play, in ms. Speed 0 for full speed. */
    speed: number,
    onStep?: () => void,
    onReset?: () => void,
    onPlay?: () => void,
    onPause?: () => void,
    onSpeedChange?: (speed: number) => void,
}

export default function SimControls({state, ...props}: Props) {
    const [showHelp, setShowHelp] = useState(false)
    const [minTick, maxTick] = [-2, 5]
    // Speed slider ticks convert to 2**tick steps per second
    const speedTick = Math.max(minTick, Math.min(Math.round(Math.log2(1000 / props.speed)), maxTick))
    const onSpeedChange = (tick: number) => {
        if (tick >= maxTick) {
            return props.onSpeedChange?.(0)
        } else {
            return props.onSpeedChange?.((1 / (2 ** tick)) * 1000)
        }
    }

    return (
        <div className="sim-controls card">
            <div className="card-body d-flex flex-row">
                {(state == "playing") ? (
                    <Button variant="" size="sm" title="Pause Simulation" onClick={props.onPause}>
                        <Icon icon={faPause} className="sim-icon text-warning"/>
                    </Button>
                ) : (<>
                    <Button variant="" size="sm" title="Run Simulation" disabled={state == "done"} onClick={props.onPlay}>
                        <Icon icon={faPlay} className="sim-icon text-success"/>
                    </Button>
                    <Button variant="" size="sm" title="Step Simulation" disabled={state == "done"} onClick={props.onStep}>
                        <Icon icon={faStepForward} className="sim-icon text-success"/>
                    </Button>
                </>)}
                {(state != "unstarted") ? (
                    <Button variant="" size="sm" title="Reset Simulation" onClick={props.onReset}>
                        <Icon icon={faStop} className="sim-icon text-danger"/>
                    </Button>
                ) : ""}
                <div className="flex-grow-1"> {/* Spacer, even if the slider is hidden */}
                    {(state == "playing") ? ( 
                        <input type="range" className="form-range" title="Speed" min={minTick} max={maxTick}
                            value={speedTick} onChange={e => onSpeedChange(+e.target.value)}
                        />
                    ) : ""}
                </div>
  
                <Button variant="" size="sm" title="Help / About" onClick={() => setShowHelp(true)}>
                    <Icon icon={faQuestionCircle} className="sim-icon text-info"/>
                </Button>
            </div>
            <HelpModal show={showHelp} onHide={() => setShowHelp(false)}/>
        </div>
   )
}