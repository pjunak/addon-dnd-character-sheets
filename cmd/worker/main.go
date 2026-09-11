package main

import (
	"context"
	"fmt"
	"github.com/pjunak/addon-dnd-character-sheets/internal/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	methods := map[string]string{}
	for _, method := range []string{"load", "evaluate", "preview", "commit", "history", "revision"} {
		methods["service/"+character.Contract+"/"+method] = character.Version
	}
	err := workerrpc.RunNativeWorker(ctx, workerrpc.NativeWorkerConfig{Reader: os.Stdin, Writer: os.Stdout, Methods: methods, HandlerFactory: workerrpc.NativeWorkerHandlerFactoryFunc(func(worker workerrpc.NativeWorkerContext) (workerrpc.RequestHandler, error) {
		data, err := workerrpc.NewAddonDataClient(worker.Peer)
		if err != nil {
			return nil, err
		}
		engine, err := workerrpc.NewServiceClient(worker.Peer)
		if err != nil {
			return nil, err
		}
		return character.New(data, engine), nil
	})})
	if err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
