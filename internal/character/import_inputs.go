package character

import (
	"fmt"
	"time"

	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

func (c *Coordinator) importedInputs(meta *workerrpc.Meta, request Request) (model.Inputs, error) {
	if request.Inputs == nil {
		return model.Inputs{}, failure(workerrpc.KindInvalidRequest, "Import requires current-format character inputs.")
	}
	grants := request.Inputs.Grants
	if len(grants) > 0 && (meta.Actor.Role != "dm" || !request.ReauthorizeGrants) {
		return model.Inputs{}, failure(workerrpc.KindUnauthorized, "Imported DM grants must be reviewed and authorized by the current DM.")
	}
	ids := make(map[string]string, len(grants))
	for i, grant := range grants {
		if _, duplicate := ids[grant.ID]; grant.ID == "" || duplicate {
			return model.Inputs{}, failure(workerrpc.KindValidationFailed, "Imported DM grants need distinct non-empty IDs.")
		}
		ids[grant.ID] = fmt.Sprintf("grant-%s-%d", request.OperationID, i)
	}
	input, err := model.RemapGrantReferences(*request.Inputs, ids)
	if err != nil {
		return model.Inputs{}, failure(workerrpc.KindValidationFailed, err.Error())
	}
	for i := range input.Build.Rolls {
		input.Build.Rolls[i].Origin = "import"
	}
	for i := range input.Play.Rolls {
		input.Play.Rolls[i].Origin = "import"
	}
	for i := range input.Build.Spells.Acquisitions {
		input.Build.Spells.Acquisitions[i].Origin = "import"
	}
	for i := range input.Build.Spells.Swaps {
		input.Build.Spells.Swaps[i].Origin = "import"
	}
	for i := range input.Grants {
		grant := &input.Grants[i]
		grant.ID = ids[grant.ID]
		grant.ActorID = meta.Actor.ID
		grant.GrantedAt = c.now().UTC().Format(time.RFC3339)
	}
	return input, nil
}
